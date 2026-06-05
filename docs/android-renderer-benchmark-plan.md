# Android Renderer Benchmark Plan

## Goal

Produce branch-comparable benchmark artifacts for Android renderer changes, with one repeatable method that can be run on both:

- baseline branch
- `feat/android-c-yoga`

The output is a stable JSON artifact plus raw JSONL samples. This gives merge-ready data for:

- cold-start frame count
- TTI / first interactive timing
- per-frame duration on a stable real app screen
- missed frame deadlines as a proxy for flashes / visible instability

## Benchmark Contract

All benchmark runs must use the same:

- physical device or emulator
- build variant
- local bundle mode
- iteration count
- benchmark scenarios
- output schema

Do not compare:

- debug vs release
- emulator vs physical device
- different devices
- different app screens

For merge-quality conclusions, prefer release-mode measurements if the shipped Android path is a release APK loading `main.hbc` from assets.

## Scenarios

### 1. `startup-apphub`

Purpose: cold-start comparison on the same real app screen used for layout measurements.

This boots the app into `AppHub`, measures launch time via `adb shell am start -W`, then captures early frame stats via `adb shell dumpsys gfxinfo ... framestats`.

Primary metrics:

- `launchThisTimeMs`
- `launchTotalTimeMs`
- `launchWaitTimeMs`
- `frameCount`
- `deadlineMissCount`
- `p95FrameMs`

### 2. `layout-apphub`

Purpose: frame-time comparison on a real, usable app screen.

This boots the app into `AppHub`, lets it warm up, resets `gfxinfo`, then runs a deterministic timeout-driven layout pulse on the same screen during the measurement window.

Primary metrics:

- `p50FrameMs`
- `p90FrameMs`
- `p95FrameMs`
- `p99FrameMs`
- `maxFrameMs`
- `deadlineMissCount`
- `frameCount`

## Output Files

Running the benchmark creates:

- `artifacts/android-perf/<branch>-<timestamp>.json`
- `artifacts/android-perf/<branch>-<timestamp>.startup.raw.jsonl`
- `artifacts/android-perf/<branch>-<timestamp>.layout.raw.jsonl`

The main JSON file is the branch comparison artifact to attach to the merge.

## How To Run

1. Build and install the Android app on the target device.
   Example:
   `cd apps/components/android && ./gradlew :app:installDebug`
2. Run the benchmark script on the first branch.
3. Switch branches.
4. Rebuild the exact same app variant.
5. Run the same benchmark script again with only `--branch` changed.

Example:

From the repo root (`/Users/zsaboi/code/zynth/framework`):

```bash
node --experimental-strip-types scripts/android-performance-benchmark.ts \
  --branch baseline-main \
  --iterations 100 \
  --package com.x64bits.zynth.components \
  --activity com.x64bits.zynth.components/.MainActivity
```

```bash
node --experimental-strip-types scripts/android-performance-benchmark.ts \
  --branch feat-android-c-yoga \
  --iterations 100 \
  --package com.x64bits.zynth.components \
  --activity com.x64bits.zynth.components/.MainActivity
```

From `apps/components`:

```bash
yarn benchmark:android --branch baseline-main --iterations 100 \
  --package com.x64bits.zynth.components \
  --activity com.x64bits.zynth.components/.MainActivity
```

From the repo root with a package script:

```bash
yarn benchmark:android --branch feat-android-c-yoga --iterations 100 \
  --package com.x64bits.zynth.components \
  --activity com.x64bits.zynth.components/.MainActivity
```

## Release Mode

If you want representative production numbers:

1. Build the Android release artifact with the bundled Hermes bytecode.
   The Zynth Android build copies `dist/main.hbc` into `android/app/src/main/assets/main.hbc` for release builds.
2. Install the release APK on the same device.
3. Run the same benchmark command against the installed release build.

Suggested flow:

```bash
cd /Users/zsaboi/code/zynth/framework/apps/components
yarn zynth build android
```

If you prefer direct Gradle install after assets are already prepared:

```bash
cd /Users/zsaboi/code/zynth/framework/apps/components/android
./gradlew :app:installRelease
```

Notes:

- `debug` and `release` use the same application id here, so installing release will replace debug on the device.
- The current runner is build-agnostic; the same benchmark command works once the desired variant is installed.
- Your release artifact should contain `android/app/src/main/assets/main.hbc`; that is the important verification point for Hermes bytecode benchmarking.

Optional flags:

- `--suites startup`
- `--suites layout`
- `--startup-observe-ms 2500`
- `--layout-warmup-ms 3000`
- `--layout-measure-ms 5000`
- `--output artifacts/android-perf/custom-name.json`

## What To Compare In The Merge

Cold start:

- lower `launchThisTimeMs`
- lower `launchTotalTimeMs`
- lower `launchWaitTimeMs`
- lower `deadlineMissCount`
- lower `p95FrameMs`

AppHub frame stats:

- lower `p95FrameMs`
- lower `p99FrameMs`
- lower `maxFrameMs`
- lower `deadlineMissCount`

## Merge Table Template

Use this table in the merge description:

| Metric | Baseline | `feat/android-c-yoga` | Delta | Direction |
| --- | ---: | ---: | ---: | --- |
| launchThisTimeMs avg |  |  |  | lower is better |
| launchTotalTimeMs avg |  |  |  | lower is better |
| launchWaitTimeMs avg |  |  |  | lower is better |
| startup deadlineMissCount avg |  |  |  | lower is better |
| startup p95FrameMs avg |  |  |  | lower is better |
| layout p95FrameMs avg |  |  |  | lower is better |
| layout p99FrameMs avg |  |  |  | lower is better |
| layout maxFrameMs avg |  |  |  | lower is better |
| layout deadlineMissCount avg |  |  |  | lower is better |

## Notes

- The benchmark path is Android-only by design.
- Startup timing is now derived from Android shell tooling (`am start -W` and `gfxinfo framestats`) so it works identically across branches without relying on app-internal export hooks.
- `deadlineMissCount` comes from `adb shell dumpsys gfxinfo <package> framestats` and is the best available branch-stable proxy here for visual flashes / frame instability.
