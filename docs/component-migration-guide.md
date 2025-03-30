# Component Migration Guide (iOS & Android)

> **Goal:** Document the architecture and workflow for migrating Rune UI components out of the core platforms (`@rune/ios`, `@rune/android`) into standalone packages (for example `@rune/components`). This guide also describes how to author a brand-new component package that ships native artifacts for both platforms.

## 1. Background and Philosophy

1. The Rune framework historically bundled every native view implementation directly into the core platform pods (`RuneKit` for iOS, `RuneKit` for Android).
2. As the ecosystem grows, component code needs to be published and versioned separately (mirroring Expo and React Native community modules).
3. Each component package now ships **JS/TS code** plus the **native iOS/Android implementation** and registers itself during the CLI prebuild step.
4. Core platforms expose minimal hooks (component registries, node abstractions, prop setters) so that external packages can plug in without patching the host.
5. The Pressable migration provides the template for future migrations.

## 2. Terminology

| Term                       | Meaning                                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Host**                   | The platform pod (`@rune/ios` / `@rune/android`) that exposes registries, node APIs, layout engine, etc.       |
| **Component Package**      | A workspace (e.g. `@rune/components`) that exports TS primitives and embeds native folders (`ios`, `android`). |
| **Descriptor / Registrar** | Structures used by native registries to create views, apply props, and hook events for custom components.      |
| **Prebuild**               | CLI command (`rune prebuild <platform>`) that scaffolds native projects and links component pods/modules.      |

## 3. High-Level Migration Checklist

1. Identify the component in `@rune/ios` and `@rune/android` (view classes, prop handlers, manager categories).
2. Copy native files into the component package under `ios` / `android` subfolders.
3. Replace direct references in the hosts with registry lookups.
4. Expose any missing host APIs through public headers or Kotlin interfaces.
5. Add metadata to the component package (`runeNative`) so the prebuild scripts auto-link pods/modules.
6. Delete the component from the host once builds succeed on both platforms.

## 4. iOS Architecture Overview

1. **Registry:** `RuneComponentDescriptor` and `RuneComponentRegistry` (Objective-C) allow packages to register components with creation, attachment, prop handling, and handler setup callbacks.
2. **SNNode exposure:** `SNNode` is now public so components can access the backing view and metadata.
3. **Host integration:** `SNUIManager` consults the registry every time `createNode(type)` is called. If a descriptor exists, it creates the view via `descriptor.createView` instead of the built-in switch-case.
4. **Prop routing:** After parsing JSON, `SNUIManager` first gives descriptors a chance to handle properties and handlers; only unhandled props fall back to legacy logic.
5. **Lifecycle:** During node attach / detach, descriptors can hook into the `SNNode` to manage delegates, pointer events, accessibility, etc.

## 5. Android Architecture Overview

1. **Registry:** Kotlin counterpart `RuneComponentRegistry` lives inside `RuneKit`. Descriptors register via `RuneComponentRegistrar` implementations discovered by `ServiceLoader`.
2. **Interfaces:** `RunePressableEventListener` (and similar future interfaces) allow components to signal events back to the host manager (`RuneUIManager`).
3. **Node Factory:** `RuneNodeFactory` queries the registry while creating nodes. Custom components provide the view instance and attach callbacks to the manager.
4. **Prop Applier:** `RunePropApplier` gives descriptors first dibs on handling properties and handlers before default switch logic.
5. **Recycling:** Component descriptors receive reset hooks so pooled nodes are cleaned when reused by lists.

## 6. Metadata (`package.json`) Schema

```json
"runeNative": {
  "ios": {
    "pods": [
      { "name": "RuneComponents", "podspec": "./RuneComponents.podspec" }
    ]
  },
  "android": {
    "modules": [
      { "name": "RuneComponents", "path": "./android/RuneComponents" }
    ]
  }
}
```

1. The CLI reads this section during `rune prebuild`.
2. For iOS, each entry is injected into the generated Podfile as `pod 'Name', :path => ...` (or `:podspec`).
3. For Android, entries are appended to `settings.gradle.kts` and `app/build.gradle.kts` as `include(":Name")` and `implementation(project(":Name"))`.

## 7. Migrating an Existing Component (Step-by-Step)

### 7.1. Preparation

1. Confirm the component is not used as a dependency by other core components (if so, migrate dependencies first or provide shims).
2. Create feature branches for iOS and Android migrations simultaneously to avoid divergent states.
3. Ensure unit / integration tests (if available) target both platforms.

### 7.2. Copy Native Code

1. Under `packages/<your-package>/ios`, add the original Objective-C/Swift files.
2. Under `packages/<your-package>/android`, create an Android library module mirroring the original Kotlin/Java sources.
3. Preserve the same license headers and update imports to point to new header/module locations.

### 7.3. Wire the iOS Descriptor

1. Import host headers (`RuneKit.h`, `SNNode.h`, etc.) using `#if __has_include` guards to support both module and local builds.
2. Implement `+load` to register the component descriptor in a category (e.g., `SNUIManager+Pressable` moved into `@rune/components`).
3. Provide the descriptor with:
   - `createView` block returning the UIKit view subtype.
   - `attach` block wiring delegates and manager references.
   - `handleSetProp` and `handleSetHandler` blocks to intercept props and events.
4. Export any new public headers from the package (`ios/include`).

### 7.4. Wire the Android Descriptor

1. Define a registrar implementing `RuneComponentRegistrar` and register via `META-INF/services`.
2. The descriptor should include:
   - `createView`: instantiate the custom view, assign default layout params, reset state.
   - `onNodeCreated`: attach listeners, set `nodeId`, update pointer defaults.
   - `applyProperty`: parse JSON strings, set properties on the view, update `node.pointerEvents` when necessary.
   - `onSetHandler`: mark long-press handlers or other flags on the view.
   - `onReset`: reset the view when recycled.
3. Update the view class to expose methods invoked by the descriptor (`setDisabled`, `setHitSlop`, `handleCommand`, etc.).

### 7.5. Remove Legacy Host Code

1. Delete the component-specific `.m/.mm/.kt` files from `@rune/ios` and `@rune/android` once the new package builds.
2. Remove direct imports and switch cases referencing the component in `SNUIManager`, `RuneNodeFactory`, `RunePropApplier`, etc.
3. Verify the component no longer appears in the host's Podspec or Gradle module (only the registry remains).

### 7.5.1. Core Cleanup Checklist

**Why:** Leaving component-specific code in the core bloats the framework and prevents the registry from being the single source of truth.

**Key Areas (Android example):**

- **RuneNodeFactory:** Remove component from `NodeType` enum, remove `ComponentCreator` object, delete cleanup logic
- **RunePropApplier:** Remove from `PropertyCategory` enum, delete property mapping entries, remove descriptor method
- **RuneUIManager:** Remove component listener implementation, field declarations, method overrides
- **RuneLayoutFlush:** Remove component parameters and constants

**Key Areas (iOS example):**

- **SNUIManager.m:** Remove `#import` for component category, delete `createNode` case, remove prop/handler dispatch calls
- **View class deletion:** Remove from core once component package registers descriptor

**Validation:**

- Run `yarn workspace <app> prebuild:<platform>` and check for compilation errors
- Grep for component name in core source—should only appear in registry lookups, not handler logic
- Full platform build should succeed without errors

### 7.6. Update Prebuild Scripts

1. Ensure `scripts/generate-ios.js` and `scripts/generate-android.js` inject new metadata.
2. Run `yarn workspace <app> prebuild:ios` and `prebuild:android` to regenerate native projects and confirm linking.

### 7.7. Validate

1. `yarn workspace <app> build` (JS bundle).
2. `cd apps/<app>/ios && pod install && xcodebuild ...` or open in Xcode.
3. `cd apps/<app>/android && ./gradlew assembleDebug`.
4. Smoke test the component in the demo app.

## 8. Adding a Brand-New Component Package

1. **Scaffold the package:** `packages/<name>` with `src`, `ios`, `android` folders.
2. **Implement the JS API:** Provide TS/JS primitives that interact with `@rune/core` host nodes (similar to the existing Pressable TS component).
3. **iOS native implementation:**
   - Create a podspec inside the package (e.g., `MyComponent.podspec`).
   - Expose public headers under `ios/include`.
   - Implement view classes and descriptor registration.
4. **Android native implementation:**
   - Create a library module (Gradle + manifest + source files).
   - Implement view classes, descriptor, registrar, and optional reset helpers.
5. **Metadata:** Update `package.json` with `runeNative` pods/modules.
6. **Build scripts:** Add `build` scripts using `rsbuild` or `tsc` similar to other packages.
7. **Local testing:**
   - `yarn workspace <package> build` (TS output).
   - Reference the component from a demo app and run prebuild/assemble steps.

## 9. CLI Prebuild Flow

1. The CLI determines the workspace root and targeted app directory.
2. For iOS:
   - Generates the template project (XcodeGen + Pod install).
   - Reads `runeNative.ios.pods` for each dependency and injects them into the Podfile placeholder `{{RUNE_COMPONENT_PODS}}`.
   - Runs `pod install` to link local pods.
3. For Android:
   - Generates the Gradle project from templates.
   - Reads `runeNative.android.modules` and injects includes/dependencies into `settings.gradle.kts` and `app/build.gradle.kts` placeholders.
   - Leaves the app ready for `./gradlew assembleDebug`.

## 10. Handling Props and Events

1. **Props:** Always parse using the helper functions in the descriptor (e.g., `parseJsonValue`). Ensure boolean, string, and number conversions handle JSON strings or typed values.
2. **Pointer Events:** Update both the native view state and the `node.pointerEvents` field so the host keeps gesture state consistent.
3. **Handlers:** When `onSetHandler` sees events like `onLongPress`, set any internal flags so the native view knows a handler exists.
4. **Commands:** Expose a special prop (such as `__pressableCommand`) to send imperative commands from JS; descriptors should forward JSON payloads to the view.

## 11. Reusing Nodes (Recycling)

1. When lists recycle views, the host calls `resetRecycledNodeState`; descriptors should supply `onReset` to clear the custom view.
2. Reset should cancel timers, clear listeners, and restore defaults to avoid leaking state between list items.

## 12. Error Handling & Debugging Tips

1. Wrap descriptor registrations in `dispatch_once` / `static` initializers to avoid duplicate registration.
2. Add logging guards so release builds remain quiet (`logDebug` helpers exist on Android).
3. Use `assert` or `NSAssert` to catch unexpected prop types during development.
4. If a component fails to load, verify `META-INF/services` naming and that Gradle copies resources into the AAR.

## 13. Publishing Considerations

1. Today the podspec points to the workspace path; for release builds, publish Git tags or podspecs to ensure deterministic installs.
2. Similarly, publish Android modules to Maven (or distribute AARs) to decouple apps from the monorepo.
3. Keep version numbers synchronized between JS and native artifacts to avoid mismatches.

## 14. Future Enhancements

1. Automate descriptor registration tests to ensure props/events remain in sync.
2. Generate component templates via CLI (`rune create component`) to reduce boilerplate.
3. Expand registries to include layout measurement hooks, accessibility mapping, and optional resource bundling.
4. Document common prop shapes in `packages/rune-core` so all hosts stay aligned.

## 15. Quick Reference Commands

```bash
# Build the component package
yarn workspace @rune/components build

# Generate native projects for an app
yarn workspace com.components.app prebuild:ios
yarn workspace com.components.app prebuild:android

# Assemble Android debug build
cd apps/components/android
./gradlew :app:assembleDebug

# Open Xcode project
open apps/components/ios/Components.xcworkspace
```

## 16. Troubleshooting Checklist

1. **Missing Headers (iOS):** Ensure headers are listed in the podspec’s `source_files` and `header_mappings_dir`.
2. **Gradle Link Errors:** Double-check module include paths generated from `runeNative` metadata.
3. **Runtime Crashes:** Confirm descriptors set delegates and listeners correctly and not before the manager exists.
4. **Prop Not Applying:** Use logging inside `applyProperty` / `handleSetProp` to verify the host is routing the prop.
5. **Recycled Views Misbehaving:** Implement proper reset logic and ensure timers/handlers are cleared.
6. **Command Sequencing:** Maintain a monotonically increasing command sequence ID to avoid reprocessing stale commands.

## 17. Pressable Migration Summary

1. Moved native implementations into `@rune/components` with corresponding podspec and Android module.
2. Registered descriptors that attach to `SNUIManager` / `RuneUIManager` on load.
3. Exposed host APIs (`SNNode`, `RunePressableEventListener`) and updated prebuild scripts to auto-link pods/modules.
4. Verified builds via `yarn workspace com.components.app build`, `pod install`, and `./gradlew assembleDebug`.

## 18. Conclusion

1. The new architecture enables modular component development, cleaner versioning, and easier community contributions.
2. Use this guide whenever migrating additional components or authoring new ones.
3. Keep documentation updated as registries evolve or new automation tooling is added.
