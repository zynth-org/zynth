# Router UI Rendering Fix

## Problem Summary

The Rune Router was correctly managing navigation state on the native side, but the SolidJS UI wasn't rendering on screen. Users saw only the navigation bar title with no content visible.

## Root Cause

The issue had **two critical problems**:

### 1. Stack Key Mismatch

**Symptom**: Stack state showed `"key": "stack-root"` but SolidJS Stack component used `"key": "stack-cl-0"`.

**Cause**: The native iOS controller (`RNStackController`) was hardcoding the stack key as `"stack-root"` in `currentStatePayload()`, while the JS Stack component dynamically generated unique IDs like `stack-cl-0` using `createUniqueId()`.

**Why it broke**: The `findStackState()` function in `Stack.tsx` searches for a matching stack by key. When the keys didn't match, it couldn't find the correct state, so `stackState()` was null, `activeRoute()` was null, and nothing rendered.

**Fix**:

- Added `stackKey` property to `RNStackController` (defaults to `"stack-root"`)
- Updated `reset()` method to capture and store the JS-provided stack key
- Modified `currentStatePayload()` to return the stored `stackKey` instead of hardcoded value

```swift
// Store the stack key from JS
if let jsStackKey = state["key"] as? String {
  stackKey = jsStackKey
}
```

Now when JS dispatches `RESET` with `key: "stack-cl-0"`, native stores and echoes back the same key, allowing JS to find the correct state.

### 2. SolidJS Reactivity Issue with `<Show>`

**Symptom**: After fixing the stack key, navigation state changed correctly but the UI still showed the old route during transitions.

**Cause**: The `StackRenderer` used `<Show when={activeRoute()}>` with a callback function:

```tsx
<Show when={activeRoute()}>
  {(current) => {
    // This callback only runs ONCE when condition becomes truthy
    // It doesn't re-run when activeRoute() changes!
  }}
</Show>
```

In SolidJS, `<Show>` with a callback captures the initial value and doesn't re-execute the callback when the signal changes. The route changed from "Home" to "Details", but the component kept rendering the Home screen.

**Fix**: Replaced `<Show>` with `createMemo()` to ensure proper reactivity:

```tsx
const renderRoute = createMemo(() => {
  const current = activeRoute();
  if (!current) return null;
  // ... render logic
  return (
    <RouteProvider>
      <Component />
    </RouteProvider>
  );
});

return <>{renderRoute()}</>;
```

Now whenever `activeRoute()` changes, the entire render logic re-executes and the correct component displays.

## Additional Fixes

### 3. Delayed State Emission (Animation Sync Issue)

**Symptom**: Content updated only after navigation animations finished, causing wrong content to show during transitions.

**Cause**: Navigation methods (`push`, `pop`) only emitted state changes in the `didShow` delegate, which fires **after** animations complete.

**Fix**: Added `emitStateChanged()` calls immediately after modifying the route stack:

```swift
func push(routeName: String, params: [String: Any]?, animated: Bool) {
  // ... create and add route ...
  navigator.pushViewController(host, animated: animated)
  emitStateChanged() // ← Immediate state emission
}
```

This ensures UI updates synchronously with animation start, not after completion.

### 4. Back Button State Sync

**Symptom**: Native back button/swipe gestures still showed delayed content updates.

**Cause**: When users tap back, iOS removes view controllers directly. Our `routeStack` wasn't synced until `didShow`.

**Fix**: Added route stack synchronization in `willShow` delegate (before animation):

```swift
public func navigationController(
  _ navigationController: UINavigationController,
  willShow viewController: UIViewController,
  animated: Bool
) {
  // Sync route stack with navigation controller state
  let currentKeys = Set(navigationController.viewControllers.compactMap {
    ($0 as? RNScreenHostController)?.routeKey
  })
  routeStack.removeAll { record in
    !currentKeys.contains(record.key)
  }
  emitStateChanged() // ← Update before animation starts
}
```

### 5. Static vs Dynamic Options Timing

**Symptom**: Header title changed mid-animation ("Details" → "Created from Home").

**Cause**: Static `options={{ title: "Details" }}` applied first, then dynamic `setOptions()` from `createEffect` ran after component mount.

**Fix**: Removed conflicting static title, using only dynamic options that depend on route params.

## Key Learnings

1. **State keys must match** between native and JS for the reconciliation system to work
2. **SolidJS `<Show>` callbacks don't re-run** - use `createMemo()` for reactive conditional rendering
3. **Emit state immediately** when navigation happens, not after animations
4. **Sync on `willShow`**, not just `didShow`, for responsive native gestures
5. **Avoid mixing static and dynamic options** for the same property

## Result

Navigation now works smoothly with:

- ✅ UI renders immediately when navigating
- ✅ Correct content shows during animations
- ✅ Back button/gestures work instantly
- ✅ Consistent header titles throughout transitions
