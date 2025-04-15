# iOS Router Architecture

_Last updated: YYYY-MM-DD_

## High-Level Flow

```
Solid JSX (NavigationContainer/Stack/Tabs)
        │
        ▼
RuneRouterModule (Swift, exported via RuneRuntime registry)
        │  dispatch/getState/setOptions/resolveBeforeRemove
        ▼
RNStackController (UIViewController wrapper around UINavigationController)
        │  manages push/pop/reset, owns route stack metadata
        ▼
RNScreenHostController (UIViewController per route)
        │  attaches shared Rune surface view
        ▼
RuneRuntime (Hermes runtime + Solid renderer)
```

## Components

### RuneRouterHost
- Entry point called from the template AppDelegate when `@rune/router` is installed.
- Creates `RNStackController`, installs it as `window.rootViewController`, and invokes `RuneRouter.attach(runtime:stackController:)`.
- Responsible for moving the shared `RuneRuntime.rootView` (the Solid surface) into the stack controller’s hierarchy.

### RuneRouterModule (Swift)
- Implements `RuneModule` and `RuneSyncModule`.
- Functions:
  - `dispatch(action)` – forwards JS actions (push/pop/etc.) to `RNStackController`.
  - `setOptions(key, options)` – updates per-route header options.
  - `getState()` (sync) – returns current navigation state snapshot.
  - `resolveBeforeRemove(requestId, cancelled)` – continues the beforeRemove handshake.
- Installs a small JS snippet that sets `globalThis.__RUNE_ROUTER__` with `getState`, `dispatch`, `setOptions`, etc.

### RNStackController
- Subclasses `UIViewController` and embeds a `UINavigationController`.
- Maintains its own route stack metadata (`RouteRecord` array) mirroring the native nav stack.
- Handles `push`, `pop`, `replace`, and `reset` requests coming from JS.
- Emits events via `RuneRouterEmitter`:
  - `rune.router.stateChanged`
  - `transitionStart` / `transitionEnd` / `transitionProgress`
  - `focus` / `blur`
  - `beforeRemove` requests
- **Surface management:**
  - The template gives us one `RuneRuntime.rootView` (the Solid view hierarchy).
  - `RNStackController` reuses that single surface across screens: when a new screen is shown, it detaches the surface from the previous host and attaches it to the new host.
  - To avoid blank content during navigation animations or interactive back gestures, the previous host captures a snapshot (`UIView.snapshotView`) before losing the surface, and clears it after the transition finishes.

### RNScreenHostController
- Simple UIViewController representing a single screen.
- Holds the route key/name/params.
- Provides `attachSurfaceView(_:)` to insert the shared Rune surface.
- `captureSnapshot()` / `clearSnapshot()` keep a static image when the surface moves away.
- Applies header options:
  - Title/large-title visibility and `headerShown`.
  - `headerTintColor`, background colors (including hex with alpha), transparency, and blur presets (`systemUltraThin`, etc.).
  - `headerShadowVisible` toggles the separator.
  - `userInterfaceStyle` lets each screen request light/dark/system to match the device theme.

### RuneRouterEmitter
- Thin helper that uses `RuneRuntime.emitEvent(name:payload:)` to send events to JS (`rune.router.*`).

## Lifecycles & State Flow

1. **Initialization**
   - Template AppDelegate creates RuneRuntime and the shared root view.
   - `RuneRouterHost.bootstrap` installs `RNStackController` as the root VC.
   - JS dispatches an initial `RESET` via the Stack component, providing the stack key and initial route.
   - `RNStackController.reset()` stores the provided `stackKey`, creates `RNScreenHostController`s, and attaches the shared surface to the top controller.
   - Emits `stateChanged` immediately so Solid mirrors the stack state.

2. **Push**
   - JS dispatches `PUSH` action.
   - `RNStackController.push` creates a new host controller and pushes it onto the UINavigationController stack.
   - Immediately emits `stateChanged` (deduped by JSON hash) so Solid updates.
   - During the transition, the previous host keeps its snapshot visible.

3. **Pop / Back Gesture**
   - Native pop (button or interactive gesture) triggers `navigationController(_:willShow:)`.
   - Route stack is trimmed to match the navigation controller’s current controllers.
   - `emitStateChanged()` fires before the animation so Solid re-renders the correct route tree.
   - `finishTransition` clears snapshots once the gesture completes or cancels.

4. **Options Updates**
   - JS calls `navigation.setOptions(() => …)`.
   - `RuneRouterModule.setOptions` forwards the payload to `RNStackController.applyOptions`, which updates the active host’s header configuration.

5. **Before Remove**
   - When Solid dispatches `POP`/`REPLACE` for a guarded route, `NavigationContainer` asks the BeforeRemoveManager. If the handler prevents the action, it doesn’t reach native.
   - For native gestures (swipe back), `RNStackController` sends `beforeRemove` event via emitter, waits for JS to call `resolveBeforeRemove`, and only allows the pop if not cancelled.

## Rendering Architecture

- **Single Surface Strategy**
  - iOS app still has one `RuneRuntime.rootView`. We don’t instantiate new Solid trees per screen.
  - Instead, the currently focused screen gets the surface. When pushing, we detach the view from the previous host and attach it to the new host.
  - Snapshots ensure the previous screen remains visible until the transition ends.
- **Future Work**
  - Multi-surface support (one surface per screen) would allow keeping React trees mounted even when off-screen. That would require runtime changes to host multiple roots.

## Event Deduplication

- To avoid UI flicker, `RNStackController` serializes the stack state (with sorted keys) and only emits when it changes. Duplicate emissions during `didShow` are skipped, so Solid doesn’t re-render unnecessarily.

## Error Handling & Logging

- Dev builds log state snapshots (`[RuneRouter] stack state …`) and active route changes to aid debugging.
- UIKit assertions (navigation bar delegate, etc.) are avoided—the router no longer sets itself as the nav bar delegate.

## Integration Checklist

1. Add `@rune/router` to app dependencies.
2. Run `yarn workspace <app> prebuild:ios` so the pod is auto-linked.
3. Ensure AppDelegate uses the template version that invokes `RuneRouterHost.bootstrap`.
4. Wrap Solid app in `<NavigationContainer>` and render stacks/tabs as needed.

## Future Enhancements

- Multi-surface or view pooling to avoid snapshot hacks.
- Shared element transitions and header customization.
- Refined predictive back progress events (per-frame). 
- Async persistence hooks bridging to iOS state restoration.
