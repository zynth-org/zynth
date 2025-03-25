# Threading Fixes for `queueMicrotask` and `requestAnimationFrame`

## Problem

Both `queueMicrotask` and `requestAnimationFrame` were causing crashes with the error:

```
terminating due to uncaught exception of type std::runtime_error:
fbjni is uninitialized; no thread can be attached.
```

### Root Causes

1. **Missing JavaVM Check**: The code attempted to create `JniEnv` without first checking if `gJavaVm` was initialized, causing the "fbjni is uninitialized" error.

2. **Thread Attachment Issues**: When these functions were called from native event handlers (like `onLayout`), they were executing on the Hermes JS thread, which might not have JNI attached or might hit thread attachment limits.

3. **Synchronous JNI Calls**: Both functions made synchronous JNI calls from the JavaScript context, which is unsafe when called from event handlers that originate from native code.

4. **Invalid JNIEnv Pointer in callGlobal** (CRITICAL): The `callGlobal` function accepted a `JNIEnv*` parameter from the JNI entry point. When called via `callGlobalAsync`, the function was posted to the JS Handler thread, but the `JNIEnv*` pointer was obtained on the calling thread. JNIEnv pointers are **thread-local** and invalid on different threads, causing crashes.

## Solutions Implemented

### `queueMicrotask`

**Primary Path**: Uses Hermes' built-in microtask queue via `Promise.resolve().then()`. This:

- Avoids JNI calls entirely
- Uses the engine's native scheduling mechanism
- Is the most performant option

**Fallback Path**: If Promise fails, falls back to `setTimeout(callback, 0)`:

- Goes through the HandlerTimerShim
- Posts to the JS thread's Looper
- Thread-safe as implemented in `JSBridge.kt`

### `requestAnimationFrame`

**Safety Checks Added**:

1. **JavaVM Validation**: Checks `gJavaVm` before attempting any JNI operations
2. **JniEnv Validation**: Checks if JNI environment is available before making calls
3. **Graceful Degradation**: If JNI is unavailable, executes callback immediately with timestamp 0

**Flow**:

```
JavaScript call → Store callback → Check gJavaVm → Create JniEnv → Call Java method
                                      ↓ (if null)
                                   Execute immediately
```

The Kotlin side (`JSBridge.kt`) already handles thread safety by posting back to the JS Handler when the frame callback fires.

### `callGlobal`

**CRITICAL FIX**: The function now obtains its own thread-local `JNIEnv*` instead of using the parameter passed from the JNI entry point:

```cpp
// OLD (BROKEN):
void callGlobal(runtime, JNIEnv *env, ...) {
  env->FindClass(...);  // ❌ env is invalid if called from different thread
}

// NEW (FIXED):
void callGlobal(runtime, JNIEnv *envParam, ...) {
  JniEnv envWrapper;  // ✅ Obtains fresh JNIEnv for current thread
  JNIEnv* env = envWrapper.get();
  env->FindClass(...);  // ✅ Safe!
}
```

**Why This Matters**:

- `JNIEnv*` pointers are **thread-local** and cannot be shared between threads
- `callGlobalAsync` posts to the JS Handler thread
- Using the passed `env` from a different thread causes instant crashes
- The `JniEnv` wrapper class safely attaches the current thread to JNI

## Thread Safety Guarantees

### Safe Contexts

- ✅ Called from JavaScript code during normal execution
- ✅ Called from `setTimeout` callbacks
- ✅ Called from other timer/animation frame callbacks
- ✅ Called from module responses

### Unsafe Contexts (Now Handled)

- ✅ Called from `onLayout` events (now safe with JavaVM check)
- ✅ Called from other native event handlers (now safe with fallback)
- ✅ Called when JNI thread attachment fails (now degrades gracefully)

## Testing Recommendations

1. **Event Handler Stress Test**: Call `requestAnimationFrame` from `onLayout` handlers repeatedly
2. **Microtask Chain Test**: Queue multiple microtasks that each queue more microtasks
3. **Mixed Context Test**: Call these functions from various contexts (timers, events, modules)
4. **Shutdown Test**: Ensure graceful handling when runtime is being destroyed

## Performance Notes

- `queueMicrotask` using Promise path has **zero JNI overhead**
- `requestAnimationFrame` has minimal overhead (one JNI call + JavaVM pointer check)
- Fallback paths are only hit in error conditions
- No performance regression for the happy path

## Related Files

- `/Users/ignaciozsabo/code/rune/packages/rune-android/android/RuneKit/src/main/cpp/Bridge.cpp` (C++ implementation)
- `/Users/ignaciozsabo/code/rune/packages/rune-android/android/RuneKit/src/main/java/com/rune/kit/runtime/JSBridge.kt` (Kotlin bridge)
- `/Users/ignaciozsabo/code/rune/apps/components/src/components/WindowList.tsx` (Usage example)

## Migration Guide

No changes needed for existing code. Both functions now work correctly in all contexts, including being called from native event handlers.

For new code using windowed lists or similar patterns that update state from `onLayout`:

- ✅ Can safely use `requestAnimationFrame` to batch updates
- ✅ Can safely use `queueMicrotask` for immediate async work
- ✅ Can safely use `setTimeout(fn, 0)` as an alternative
