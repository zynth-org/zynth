## Android Runtime Changes To Mirror On iOS (Temporary)

Goal: replicate Android runtime/components behavior in iOS while staying JSI-first and avoiding JSON parsing.

### Build/Prebuild Wiring
- Android template now supports dynamic Gradle includes via `zynthNative.android.gradleProjects` metadata in package.json.
- `scripts/generate-android.ts` collects `gradleProjects` and injects `include(...)` lines into `settings.gradle.kts`.
- `@zynth/components` declares:
  - `zynthNative.android.modules`: `ZynthComponents`
  - `zynthNative.android.gradleProjects`: `ZynthAPIs` with `package: "@zynth/apis"`

### Core Runtime (Android)
- Introduced a typed batch path with string table + numeric op buffer.
  - JS host encodes typed ops in `packages/zynth-core/src/host/android.ts`.
  - C++ decoder lives in `packages/zynth-core/android/ZynthKit/src/main/cpp/zynthkit.cpp`.
  - Android host now requires typed batch (`__supportsTypedBatch`) and no JSON fallback.
- Added `ZynthEventSink` in core (generic event dispatch for components).
- `ZynthUIManager` gained:
  - `attachments` on nodes (component-owned state).
  - `markNodeDirty` to force text remeasure.
  - `getNodeState` + `getParentId` for text composition.
- Removed component-specific types from core (ImageState, TextStyleAttributes, Pressable listener).

### Components (Android)
- Added `META-INF/services/com.zynth.kit.components.ZynthComponentRegistrar` so ServiceLoader discovers all registrars.
- Pressable now dispatches events through `ZynthEventSink` instead of core-specific listener.
- Image/Text/TextInput state lives in `node.attachments[...]`.
- Text composition was restored in components:
  - `TextComposer` added in components.
  - Text descriptor composes nested `<Text>` children into a single TextView.
  - Recompose on `text` prop changes and on style changes.
- `ZynthViewContainer` now extends `ZynthLayoutView` (prevents FrameLayout from overriding Yoga layouts).
- `TextComponentDescriptor` scales `fontSize` by density (dp -> px).

### APIs (Android)
- Moved `FontRegistry` into `@zynth/apis` so components can depend on APIs without core owning it.

### iOS Parity Checklist
- Implement typed batch (string table + op buffer) in iOS host and native side.
- Ensure iOS host requires typed batch (no JSON fallback).
- Add iOS equivalent of component registrars discovery (ServiceLoader analog / module registry).
- Move iOS text composition into components (same algorithm as Android, no core dependency).
- Ensure View container avoids UIKit auto-layout/auto-sizing fighting Yoga (use ZynthLayoutView equivalent).
- Scale text sizes by density/scale factor in text descriptor or composer.
- Move `FontRegistry` to `@zynth/apis` on iOS.

Notes:
- Keep `frame summary` + `over budget` logs; remove other verbose logs after validation.
