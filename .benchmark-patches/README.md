# Android Benchmark Carryover

These files preserve the benchmark instrumentation needed to compare `feat/android-c-yoga` against `main`.

Why this bundle exists:
- `apps/components/android/**` is a generated Android app tree and is ignored by Git.
- The benchmark hook in `MainActivity.kt` therefore does not appear in normal diffs.
- The runtime changes in `zynth-core` are tracked, but switching to `main` will replace them.

What is in this folder:
- `tracked-runtime-benchmark.patch`
  - Patch for tracked benchmark-specific changes in:
    - `package.json`
    - `packages/zynth-core/android/ZynthKit/src/main/java/com/zynth/kit/runtime/ZynthNativePerformanceOverlay.kt`
    - `packages/zynth-core/android/ZynthKit/src/main/java/com/zynth/kit/runtime/ZynthRuntime.kt`
- `MainActivity.benchmark-hooks.ktfrag`
  - Benchmark-only Kotlin snippets extracted from the generated app `MainActivity.kt`
  - This is the separate source of truth for the ignored app hook

What does not need extra carryover:
- `scripts/android-performance-benchmark.ts`
- `docs/android-renderer-benchmark-plan.md`

Those files are currently untracked, so they should remain in the working tree when switching branches unless you clean untracked files.

Leakage / overhead notes:
- The native Yoga sampling path is gated behind `setPerformanceSamplingEnabled(true)`.
- The app hook only enables that path when `ZYNTH_BENCHMARK_SCENARIO` is present.
- Normal app runs should not execute benchmark export/reset flow.

Planned use on `main`:
1. Switch branches.
2. Reapply `tracked-runtime-benchmark.patch`.
3. Reapply the `MainActivity` hook from `MainActivity.benchmark-hooks.ktfrag`.
4. Rebuild the release APK.
5. Run the same benchmark command on `main`.
