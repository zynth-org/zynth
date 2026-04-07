# iOS Project Generation Migration Plan

This is a future cleanup plan for the generated iOS `project.yml` files. The current XcodeGen flow should remain in place until the migration is implemented and verified.

## Problem

The iOS `project.yml` file mixes declarative Xcode project configuration with imperative build logic. XcodeGen is a good fit for target settings, Info.plist entries, sources, dependencies, and schemes, but long shell blocks inside YAML are easy to miss during review and can fail silently when an unsupported key is used.

The recent `BundleJS` issue came from this category: bundle-copy logic existed in YAML, but the key used for the build phase was not emitted into the generated Xcode project.

## Direction

- Keep XcodeGen as the source of truth for the iOS project shape.
- Keep `project.yml` focused on declarative Xcode configuration.
- Move bundle/resource packaging logic out of inline YAML and into a checked-in script generated with the iOS app template.
- Keep the Xcode build phase small, ideally only calling the generated script.
- Add CLI validation after `xcodegen generate` to confirm required build phases and resource outputs are present in the generated `.xcodeproj`.

## Proposed Shape

The generated `project.yml` should keep a short build phase:

```yaml
preBuildScripts:
  - name: BundleJS
    inputFiles:
      - $(SRCROOT)/../dist/main.js
      - $(SRCROOT)/../dist/main.hbc
    outputFiles:
      - $(BUILT_PRODUCTS_DIR)/$(UNLOCALIZED_RESOURCES_FOLDER_PATH)/main.hbc
    script: |
      "$SRCROOT/scripts/zynth-bundle-ios-resources.sh"
```

The script should handle Release-only packaging, copy `main.hbc` when present, keep `main.js` as a fallback artifact if desired, and copy bundled assets. It should avoid requiring Node from an Xcode-launched environment unless the CLI can resolve and inject a stable Node path.

## Validation

- Generate a fresh iOS app.
- Run `xcodegen generate`.
- Verify the generated `.xcodeproj` contains a `BundleJS` `PBXShellScriptBuildPhase`.
- Build Release for simulator and device/archive.
- Confirm `main.hbc` is present inside the built `.app`.
- Confirm runtime startup uses Hermes bytecode when `main.hbc` is present and falls back to JavaScript only when bytecode is absent.
