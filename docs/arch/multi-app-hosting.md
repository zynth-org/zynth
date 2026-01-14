# Multi-App Hosting Architecture & API Contract

## Goals

- Allow a host Rune app to mount one or more guest apps inside arbitrary containers, each with its own Hermes runtime and Yoga tree.
- Keep host and guest failures isolated: guest errors surface to the host, but do not take down the host UI.
- Provide familiar, ergonomic APIs (component + hooks) for lifecycle, messaging, and splash/loading states.
- Keep the feature optional so single-app hosts continue to work unchanged.

## Architecture Overview

- **Runtime boundaries**: Every guest uses its own `RuneRuntime` (Hermes + module registry + UI manager). Host continues to own its original runtime. No global/shared singletons are assumed between them beyond the OS process.
- **Embedded containers**: Each guest is rendered into a native “embedded host” view that registers a surface with its runtime and pins Yoga layout to the enclosing container. Surfaces are scoped to that runtime so node IDs and handlers don’t collide.
- **Bundle loading (no HMR)**: Guest runtime loads from a provided bundle source (URL, on-device asset/file, or inline string/blob). HMR/dev-server is disabled for guests; only the host runtime may use HMR. Guests must be restartable via `reload()` with a new bundle payload.
- **Safe area & dimensions virtualization**: Safe area/dimensions modules read the enclosing container’s bounds instead of the full window. JS receives container-scoped metrics for layout.
- **Messaging bus**: A scoped bridge (modeled after `postMessage`) routes messages between host and guest. Internally it uses a per-runtime emitter/module to avoid cross-runtime name collisions.
- **Lifecycle controls**: Host can mount, reload, and dispose guests explicitly. Disposal tears down Hermes, UI nodes, modules, timers, and listeners for that runtime.
- **Error handling**: Guest runtime exceptions are caught and forwarded to the host via callbacks. Host may show an overlay while keeping its own tree alive.
- **Router isolation**: `rune-memory-router` instances are scoped per guest runtime. Navigation state, surfaces, and router-managed view controllers/fragments never register on the host’s runtime. Host routing (if any) is independent.

## Proposed API Contract (JS)

Host-facing:

```tsx
type GuestBundle =
  | { url: string }
  | { asset: string }          // packaged with the host
  | { code: string };          // inline JS or base64 provided by host (no HMR)

type GuestAppProps = {
  bundle: GuestBundle;
  initialProps?: Record<string, any>;
  style?: Style;              // container sizing; drives guest dimensions
  splash?: JSX.Element;       // shown until guest signals ready
  onReady?: () => void;
  onError?: (err: { message: string; stack?: string }) => void;
  onMessage?: (payload: unknown) => void;
};

const controller = useGuestAppController();

<GuestApp {...props} controller={controller} />;

controller.postMessage(payload);
controller.reload(nextBundle?);
controller.dispose();
controller.isReady(); // bool
```

Guest-facing (inside the guest bundle):

```ts
const bridge = useHostBridge(); // provided by the multi-app package

bridge.onMessage((payload) => {
  /* handle host events */
});
bridge.postMessage({ type: "ready" });
bridge.getMetrics(); // returns safe area + dimensions for this container
bridge.onHostMetrics((metrics) => {
  /* respond to container resizes */
});
bridge.onDispose(() => {
  /* cleanup */
});
```

Notes:

- `useGuestAppController` is optional; `<GuestApp>` can operate unmanaged for simple cases.
- Messages are serialized (JSON) by default; binary channel can follow later if needed.

## Native Responsibilities

- **iOS** (`packages/rune-ios`):
  - Add `RuneEmbeddedHostView` (UIView) that owns a `RuneRuntime`, registers a surface tied to its own Yoga root, and forwards safe area/dimension updates from its bounds.
  - Hook `onException`/diagnostics to surface errors back to JS callbacks instead of crashing the host.
  - Provide APIs to load bundle (URL/NSData), start, reload, and dispose.
- **Android** (`packages/rune-android`):
  - Add `RuneEmbeddedHostView` (FrameLayout) wrapping a `RuneRootView` + `RuneRuntime`; registers a surface scoped to its runtime and measures using the container’s size.
  - Mirror error forwarding, lifecycle, and bundle loading (asset/file/string).
  - Ensure timers/handlers/emitter subscriptions are cleared on dispose.
- **Bridged module for messaging**:
  - Per-runtime native module that exposes `postMessage`/`addListener` to JS.
  - Payloads tagged with runtime ID to avoid cross-talk.
- **Router scoping**:
  - Router hosts (iOS `RuneRouterHost`, Android router host) must accept an injected `RuneRuntime`/surface root instead of using global singletons.
  - Router surfaces/tabs are registered against the guest runtime’s UI manager; no surfaces leak into the host runtime.
  - Guard `globalThis.__RUNE_ROUTER__` to be runtime-local; avoid cross-runtime globals.
- **Router conflict avoidance (current issues to address)**:
  - iOS router keeps static singletons (`RuneRouter.module`, `RuneRouterHost.currentWindow`) and attaches to a single runtime. This must be made runtime-scoped to avoid cross-runtime state bleed.
  - Router surface allocation relies on `runtime.registerSurface`; past conflicts came from shared active surfaces and root surface reuse. In multi-runtime mode, every router instance must create/register surfaces only against its own runtime and never call host-level `setActiveSurface`.
  - Tabs/icon surfaces must also be scoped to the guest runtime and must not reuse root surface `0` reserved by the host.

## Bundling & CLI

- Add CLI target to build guest bundles separately (e.g., `rune bundle guest --entry apps/guest/index.tsx`).
- Templates opt-in block to mount a demo guest inside the host for smoke tests.
- Document that guests do **not** use HMR/dev-server; bundles must come from host-provided asset/file/URL/string, and reload is via full runtime reset.

## Phased Delivery & Checkpoints

1. **Design/API stub (JS-only)**: land the proposed component/hook signatures with no native behavior; use mocks in the dev harness. Checkpoint: renders a placeholder guest box.
2. **Native container runtimes**: add embedded host views + lifecycle on both platforms; render a static guest bundle into a container. Checkpoint: host shows guest UI occupying 80% of screen.
3. **Messaging bus**: wire the scoped emitter/module; verify host↔guest messages in the harness. Checkpoint: round-trip message demo.
4. **Router isolation pass**: update `rune-memory-router` bootstrap to accept an injected runtime/surface, prevent global router state, and ensure router-managed surfaces/tabs stay within the guest runtime. Checkpoint: host router unaffected when guest navigates; guest router unaffected when host navigates.
5. **Safe area/dim virtualization**: container-based metrics in `@rune/safe-area` and `Dimensions`. Checkpoint: guest reports container-sized metrics and layouts correctly.
6. **Error isolation & reload**: forward exceptions, keep host alive, support `reload`/`dispose`. Checkpoint: guest crash shows host overlay, host remains interactive.
7. **Packaging/docs**: CLI support + template snippets + final docs. Checkpoint: `yarn build` passes and demo scenario works on both platforms.

## Naming Options

Candidates: `rune-multiapp`, `rune-host`, `rune-nest`, `rune-sandbox`, `rune-hypervisor`.
