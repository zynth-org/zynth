# Android Router Status - Native Navigation Implementation

**Date:** November 10, 2025  
**Status:** 🟡 In Progress - Native navigation working, content rendering pending

## Why a Separate Package?

We created `@rune/android-router` as a **separate ephemeral package** instead of modifying `@rune/router` directly for these reasons:

1. **Iteration Speed**: The existing `@rune/router` was causing freezes and "Isn't Responding" errors on Android. We needed a clean slate to experiment without breaking the existing implementation.

2. **Validation First**: We wanted to prove that native Android Fragment-based navigation works before integrating it into the main router package.

3. **Minimal Scope**: Started with a deliberately minimal implementation to avoid the complexity that caused the original issues.

4. **Risk Mitigation**: If this approach fails, we haven't polluted the main router codebase.

5. **Clear Merge Path**: Once stable and proven, we'll merge this implementation back into `@rune/router` and remove this package.

## Current Status: ✅ Native Navigation Working!

### What's Working

- ✅ **100% Native Android Fragment Navigation**

  - No JavaScript rendering for navigated screens
  - Native slide-in/slide-out animations
  - Android back button support via FragmentManager
  - Fragment lifecycle management

- ✅ **Proper Architecture**

  - Single runtime for entire app (not one per screen)
  - JS renders initial screen (Home)
  - Native takes over for navigation (PUSH/POP)
  - Fragment-based stack management

- ✅ **Bridge Communication**
  - JS → Native: `modules.call("RuneAndroidRouter", "navigate", [screenName, params])`
  - Native module properly registered and callable
  - Args unwrapping handled (bridge passes arrays as nested Object[])

### What's Pending

- ⚠️ **Content Rendering**: Fragments are created with native animations but don't show screen content yet

  - Fragment has RuneRootView with unique rootId
  - Global `__renderRouterScreen(rootId, screenName, params)` function installed
  - Need to wire up actual component rendering into Fragment's rootId

- 🔜 **goBack Implementation**: Native back button works via FragmentManager, but JS goBack() needs testing

- 🔜 **Cleanup**: Remove all 🔥 debug logging once stable

## Architecture

### Package Structure

```
packages/rune-android-router/
├── package.json                 # runeNative.android config with initializer
├── src/
│   ├── index.ts                # Main exports + nativeRenderer import
│   ├── NavigationContainer.tsx # Root component, handles RESET vs PUSH/POP
│   ├── Stack.tsx               # Stack navigator renderer
│   ├── Screen.tsx              # Screen registration
│   ├── context.ts              # SolidJS contexts, hooks, screen registry
│   ├── types.ts                # Type definitions
│   ├── routerFactory.ts        # Type-safe router factory
│   └── nativeRenderer.ts       # Global __renderRouterScreen function
└── android/
    └── RuneAndroidRouter/
        └── src/main/java/com/rune/androidrouter/
            ├── RuneAndroidRouterHost.kt       # Bootstrap, stores main runtime
            ├── RuneAndroidRouterBridge.kt     # RuneModule implementation
            └── RuneNavigationContainer.kt     # Fragment management + RuneScreenFragment
```

### Key Files

#### JavaScript Layer

**`NavigationContainer.tsx`**

- Detects native module availability
- For `RESET`: Updates JS state (renders initial screen)
- For `PUSH/NAVIGATE/POP/GO_BACK`: Delegates to native, skips JS state update
- Calls `modules.call("RuneAndroidRouter", "navigate", [name, params])`

**`nativeRenderer.ts`**

- Installs global `__renderRouterScreen(rootId, screenName, params)` function
- Native Fragments call this to render content
- TODO: Implement actual component rendering

#### Native Layer

**`RuneAndroidRouterHost.kt`**

- Bootstrap method called by MainActivity
- Stores reference to main runtime (`setMainRuntime()`)
- Initializes navigation container with FragmentManager

**`RuneAndroidRouterBridge.kt`** (implements `RuneModule`)

- Handles `navigate(screenName, paramsJson)` method
- Handles `goBack()` method
- Unwraps nested arrays from bridge (workaround for bridge design)
- Calls `navigationContainer.pushScreen()`

**`RuneNavigationContainer.kt`**

- Manages FragmentManager
- `pushScreen()`: Creates Fragment with custom slide animations, adds to back stack
- `popScreen()`: Pops Fragment from back stack
- **`RuneScreenFragment`**: Fragment class that hosts each screen
  - Creates RuneRootView with unique rootId
  - Gets main runtime (not creating new one!)
  - Evaluates JS to call `__renderRouterScreen(rootId, screenName, params)`

### Data Flow

```
User presses "Navigate" button
  ↓
JS: navigation.navigate("Details", {params})
  ↓
NavigationContainer.dispatch({type: "PUSH", name: "Details", params})
  ↓
modules.call("RuneAndroidRouter", "navigate", ["Details", paramsJson])
  ↓
BRIDGE (C++ wraps array into Object[])
  ↓
RuneAndroidRouterBridge.call("navigate", args)
  ↓ (unwrap nested array)
  ↓
navigationContainer.pushScreen("Details", params)
  ↓
FragmentManager.beginTransaction()
  .setCustomAnimations(slide_in_left, slide_out_right, ...)
  .add(android.R.id.content, RuneScreenFragment, "Details")
  .addToBackStack("Details")
  .commit()
  ↓
RuneScreenFragment.onViewCreated()
  ↓
Get main runtime (RuneNavigationContainer.getMainRuntime())
  ↓
Evaluate JS: __renderRouterScreen(rootId, "Details", params)
  ↓
[TODO] Render Details component into Fragment's RuneRootView
```

## Testing

**Test App:** `apps/components/src/components/router/RouterMinimal.tsx`

```tsx
const Router = createRouter({
  Home: undefined,
  Details: { message: string },
});

<Router.Navigator>
  <Router.Screen name="Home" component={HomeScreen} />
  <Router.Screen name="Details" component={DetailsScreen} />
</Router.Navigator>;
```

**Current Behavior:**

1. Home screen renders with JS ✅
2. Press "Test Navigation →" button
3. Native slide-in animation ✅
4. Fragment appears (currently blank white/black) ✅
5. Android back button returns to Home ✅

**Logs confirming native navigation:**

```
[RuneAndroidRouter] 🚀 Delegating to NATIVE, skipping JS rendering
[RuneAndroidRouter] ✅ Navigation delegated to native, JS state unchanged
RuneScreenFragment: 🔥🔥🔥 Fragment onCreate: screen=Details
RuneScreenFragment: 🔥🔥🔥 onCreateView: screen=Details
```

**NO JS rendering** (`[Host/createNode]`) occurs after navigation! ✅

## Key Learnings

### Bridge Design Issue

The C++ bridge wraps JS arrays into a single Java Object[] argument:

```kotlin
// JS: modules.call("Module", "method", [arg1, arg2])
// Native receives: args = [Object[arg1, arg2]]  ← nested!

// Workaround:
val actualArgs = if (args.size == 1 && args[0] is Array<*>) {
    args[0] as Array<Any?>
} else {
    args
}
```

### Single Runtime Architecture

**❌ WRONG:** Create new runtime for each Fragment

- Too expensive
- Each runtime loads entire bundle
- Memory intensive

**✅ CORRECT:** One runtime for entire app

- Fragments just provide different container views (rootIds)
- Main runtime renders into multiple rootIds
- Each Fragment gets unique rootId via RuneRootView

### JS State Management

- **RESET action:** Must update JS state for initial screen to render
- **PUSH/POP actions:** Must NOT update JS state (let native handle)
- This hybrid approach enables native navigation while keeping initial render in JS

## Next Steps

1. **Implement content rendering** in `nativeRenderer.ts`

   - Use main runtime to render specific screen into Fragment's rootId
   - Pass screen component and params correctly
   - Handle RouteProvider context

2. **Test goBack()** from JS

   - Verify it calls native popScreen()
   - Ensure Fragment lifecycle is correct

3. **Add more screens** to test deeper navigation stacks

4. **Performance testing**

   - Verify no memory leaks
   - Confirm animations are smooth
   - Test rapid navigation

5. **Clean up logging** (remove 🔥 markers)

6. **Merge into @rune/router**
   - Create platform-specific implementations
   - Keep iOS implementation separate
   - Make Android use this native approach
   - Remove @rune/android-router package

## References

- Original issue: `@rune/router` freezing on Android
- Test file: `apps/components/src/components/router/RouterMinimal.tsx`
- Main runtime: `packages/rune-android/android/RuneKit/src/main/java/com/rune/kit/runtime/RuneRuntime.kt`
- Fragment docs: `docs/router/` (this directory)

---

**Status:** Native navigation proven to work! Ready to implement content rendering.
**Timeline:** Ephemeral package, will be merged into `@rune/router` once stable.
**Risk:** Low - isolated package, easy to rollback if needed.
