Rune — Hybrid SolidJS native framework

Overview

Rune is an experimental hybrid UI runtime that brings SolidJS-style reactivity to native iOS apps. It provides a small core renderer (`@rune/core`) and a native iOS framework (`RuneKit`) that integrates JavaScriptCore, UIKit, and Yoga for layout. This repository contains the monorepo for the framework and a sample app `@demo/sn-demo` (Rune Demo) used for development.

Why Rune / Why Solid

- SolidJS reactivity: fine-grained reactivity with minimal runtime overhead.
- Predictable updates: deterministic update propagation with explicit signals and memoization.
- Fast rendering: minimal reconcilation thanks to Solid's model (no virtual DOM patching).

Features

- Universal renderer API in `@rune/core` for writing platform-agnostic UI code.
- iOS native runtime in `native/ios/RuneKit` (Objective-C/C++) and Podspec for integration.
- Example app `apps/sn-demo` demonstrating development flow and iOS/Android prebuild.
- Rollup-based bundling for demo app (`apps/sn-demo/rollup.config.mjs`).
- Prebuild tooling to generate Xcode/Pods configuration from `app.json`-style config using `rune` key.

Repository layout

- apps/sn-demo — example app workspace (`@demo/sn-demo`) with rollup, iOS template, and scripts
- packages/rune-core — core JS renderer and components (`@rune/core`)
- native/ios/RuneKit — native iOS framework and podspec
- scripts — prebuild scripts for generating native projects (iOS & Android)
- templates — iOS/Xcode and Android/Gradle templates used by prebuild

Quick start (development)

1. Install dependencies (root of repo):

```bash
cd /path/to/repo
yarn
```

2. Build the core package and demo bundle:

```bash
yarn workspace @rune/core build
yarn workspace @demo/sn-demo build
```

3. Generate iOS project and install CocoaPods:

```bash
yarn workspace @demo/sn-demo prebuild:ios
yarn workspace @demo/sn-demo prebuild:android
yarn workspace @demo/sn-demo ios:pods
```

4. Build and run in the simulator:

```bash
yarn workspace @demo/sn-demo ios:build
yarn workspace @demo/sn-demo ios:run
# or combined dev flow
yarn workspace @demo/sn-demo ios:dev
```

Important notes & troubleshooting

- Workspace name conflicts: If you rename packages, ensure there aren't duplicate package folders with the same `name` in their `package.json`. Remove or rename old folders before running `yarn`.
- Peer dependencies: `@rune/core` has a peer dependency on `solid-js`. Install `solid-js` in the consuming workspace (example: `apps/sn-demo`).
- Rollup aliasing: `apps/sn-demo/rollup.config.mjs` uses aliasing to point imports to local `packages/rune-core/src` during development; keep paths updated if you move packages.
- Xcode warnings: Some build-phase scripts may run every build due to missing outputs; this is informational and doesn’t block builds.

Contributing

Contributions are welcome. Open issues for bugs or design discussions. For larger changes, please open a PR with tests and a short explanation of the design tradeoffs.

License

MIT
