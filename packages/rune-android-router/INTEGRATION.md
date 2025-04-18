# RuneAndroidRouter Module Registration

## Problem Solved

The router was looking for module "RuneRouter" but we're using "RuneAndroidRouter". The module wasn't registered with the runtime.

## What Was Added

### 1. Kotlin Module (`RuneAndroidRouterModule.kt`)

Implements `RuneModule` and `RuneSyncModule` interfaces to integrate with Rune's module system:

- **Module name**: "RuneAndroidRouter"
- **Sync method**: `getState()` returns null (JS manages state for now)
- **Async methods**: `navigate()`, `goBack()` (placeholders for future native nav)

### 2. Bootstrap Host (`RuneAndroidRouterHost.kt`)

Entry point for MainActivity to register the module:

```kotlin
RuneAndroidRouterHost.bootstrap(activity, runtime, rootView)
```

### 3. Updated TypeScript Bridge (`NavigationContainer.tsx`)

Now properly connects to the native module:

- Checks for `__modules.callSync` availability
- Calls `RuneAndroidRouter.getState()` on initialization
- Falls back gracefully if native module not found

## Integration in MainActivity

You need to add this to your app's `MainActivity.kt`:

```kotlin
import com.rune.androidrouter.RuneAndroidRouterHost

class MainActivity : AppCompatActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // ... existing setup ...

    val runtime = RuneRuntime(root)
    runtime.installDefaultModules()

    // ADD THIS: Register the Android router module
    RuneAndroidRouterHost.bootstrap(this, runtime, root)

    // ... rest of setup ...
    runtime.start(root.rootId)
  }
}
```

## Module Build Files

Make sure your app's `settings.gradle.kts` includes:

```kotlin
include(":RuneAndroidRouter")
project(":RuneAndroidRouter").projectDir = file("../../packages/rune-android-router/android/RuneAndroidRouter")
```

And in `app/build.gradle.kts`:

```kotlin
dependencies {
    implementation(project(":RuneAndroidRouter"))
    // ... other deps
}
```

## What Happens Now

1. ✅ Module "RuneAndroidRouter" is registered with the runtime
2. ✅ JavaScript can call `__modules.callSync("RuneAndroidRouter", "getState")`
3. ✅ The error "Module RuneRouter not found" should be gone
4. ✅ Router will initialize with JS-managed state (minimal implementation)

## Next Steps

1. Add the bootstrap call to your MainActivity
2. Include the module in your Android build
3. Test that the module is registered (check logs for "RuneAndroidRouter module initialized")
4. Verify RouterMinimal.tsx renders successfully
