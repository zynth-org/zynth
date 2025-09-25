# Android Cold Start Analysis & Fix Plan

## Problem
The Android application exhibits visible layout shifts during cold start. The UI appears to be "sorting" itself after the splash screen is dismissed.

## Root Cause
The Android system default splash screen (on Android 12+) or the initial window background is dismissed as soon as the first frame is drawn. In the current implementation, `MainActivity` sets `RuneRootView` as the content view immediately. `RuneRootView` is initially empty.

1. `MainActivity` starts.
2. `RuneRootView` is attached.
3. System sees a valid view hierarchy and draws the first frame (empty white/black screen).
4. Splash screen dismisses.
5. `RuneRuntime` starts JS.
6. JS calculates layout (Yoga).
7. JS sends view operations to Native.
8. Native updates UI -> User sees elements appearing/moving (layout shift).

## Solution
We need to delay the dismissal of the splash screen until the first meaningful frame is rendered by the Rune runtime.

We can achieve this using the `androidx.core:core-splashscreen` library, which provides backward compatibility for the Android 12 Splash Screen API.

### Implementation Steps

1.  **Add Dependency**: Add `androidx.core:core-splashscreen` to `packages/rune-templates/android/app/build.gradle.kts`.

2.  **Update MainActivity**:
    *   Call `installSplashScreen()` in `onCreate` before `super.onCreate()`.
    *   Use `setKeepOnScreenCondition` to hold the splash screen.
    *   Leverage `RuneRuntime.addSurfaceFirstFrameListener` (which delegates to `RuneLayoutFlush`) to detect when the first batch of UI updates has been flushed to the screen.
    *   Update the condition flag when the listener fires.

### Expected Behavior
The splash screen will remain visible while the JS engine initializes and performs the initial layout. Once the first frame of actual UI content is ready, the splash screen will dismiss, revealing the stable UI instantly.

## Verification
*   Cold start the app.
*   Verify no white flash or layout shifts occur.
*   Verify the splash screen dismisses correctly even if errors occur (add timeouts/safety nets if needed, though `RuneRuntime` should handle errors).
