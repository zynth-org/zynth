# App Module Template

This template provides a complete starting point for creating a native module that lives inside a Zynth app (under `apps/**/modules`).

## Template Variables

Before using this template, replace the following placeholders throughout all files:

- `{{MODULE_NAME}}` - Package name in kebab-case (e.g., `safe-area`, `keyboard`, `haptics`)
- `{{MODULE_NAME_PASCAL}}` - Module name in PascalCase (e.g., `SafeArea`, `Keyboard`, `Haptics`)
- `{{MODULE_NAME_UPPER}}` - Module name in SCREAMING_SNAKE_CASE (e.g., `SAFE_AREA`, `KEYBOARD`, `HAPTICS`)
- `{{MODULE_DESCRIPTION}}` - Brief description of the module's purpose

## Quick Start

### 1. Copy Template

```bash
cp -r packages/zynth-cli/src/templates/app-module apps/my-app/modules/my-module
cd apps/my-app/modules/my-module
```

### 2. Replace Placeholders

Use find-and-replace in your editor or run:

```bash
# macOS/Linux
find . -type f -not -path "*/node_modules/*" -exec sed -i '' \
  -e 's/{{MODULE_NAME}}/my-module/g' \
  -e 's/{{MODULE_NAME_PASCAL}}/MyModule/g' \
  -e 's/{{MODULE_NAME_UPPER}}/MY_MODULE/g' \
  -e 's/{{MODULE_DESCRIPTION}}/My awesome native module/g' \
  {} +

# Rename template files
mv "Zynth{{MODULE_NAME_PASCAL}}.podspec" "ZynthMyModule.podspec"
mv "src/{{MODULE_NAME_PASCAL}}Provider.tsx" "src/MyModuleProvider.tsx"
mv "ios/{{MODULE_NAME_PASCAL}}Module.swift" "ios/MyModuleModule.swift"
mv "android/Zynth{{MODULE_NAME_PASCAL}}" "android/ZynthMyModule"
```

Update the Android package/namespace in `android/ZynthMyModule/build.gradle.kts` and the Kotlin `package` declarations to a valid identifier (e.g. `dev.zynth.mymodule`).

### 3. Implement Your Module

**TypeScript (`src/`):**

- `types.ts` - Define your module's state interface
- `*Provider.tsx` - Update the context provider with your state logic
- `hooks.ts` - Already configured, but you can add more hooks

**iOS (`ios/`):**

- `*Module.swift` - Implement native observation and state calculation
- Update `getCurrentState()` with your actual logic
- Add platform observers in `startObserving()`

**Android (`android/`):**

- `android/Zynth{{MODULE_NAME_PASCAL}}` contains the Android library module
- Update the Kotlin package/namespace to a valid identifier (e.g. `dev.zynth.mymodule`)
- `{{MODULE_NAME_PASCAL}}Module.kt` handles state and emits `{{MODULE_NAME_PASCAL}}:change`
- `{{MODULE_NAME_PASCAL}}Bridge.kt` exports constants and sync state access

### 4. Bootstrap

```bash
yarn zynth bootstrap ios
```

### 5. Use in Your App

```tsx
import { MyModuleProvider, useMyModuleState } from "../modules/my-module/src";

function App() {
  return (
    <MyModuleProvider>
      <MyComponent />
    </MyModuleProvider>
  );
}

function MyComponent() {
  const state = useMyModuleState();

  return (
    <View>
      <Text>Value: {state().value}</Text>
      <Text>Status: {state().status}</Text>
    </View>
  );
}
```

## File Structure

```
app-module/
├── package.json              # Local module metadata with zynthNative config
├── Zynth*.podspec            # iOS CocoaPods specification
├── tsconfig.json            # ESM build config
├── tsconfig.json            # TypeScript compilation config
├── tsconfig.types.json      # Type declaration config
├── README.md                # This file
├── src/
│   ├── index.ts            # Package exports
│   ├── types.ts            # TypeScript interfaces
│   ├── *Provider.tsx       # SolidJS context provider
│   └── hooks.ts            # React-style hooks
└── ios/
    └── *Module.swift       # iOS native implementation
└── android/
    └── Zynth*              # Android native implementation
```

## Key Concepts

### SolidJS Reactivity

- **Always use Accessors**: Context stores `Accessor<T>`, not `T`
- **Call accessors to read**: `state().value` not `state.value`
- **Never destructure**: `const { value } = state()` breaks reactivity
- **Use createMemo**: For derived values that depend on state

### Native Bridge (NativeConstants + ZynthNativeEmitter)

- Native side exports `constantsToExport` to `globalThis.NativeConstants`
- Native side emits `{{MODULE_NAME_PASCAL}}:change` events
- JS reads initial state from `NativeConstants` or `__modules.callSync("getCurrentState")`
- JS subscribes to updates via `sharedNativeEventEmitter`

Example subscription:

```ts
import { sharedNativeEventEmitter } from "@zynthjs/core";

const initial = (globalThis as any).NativeConstants?.{{MODULE_NAME_PASCAL}};
const subscription = sharedNativeEventEmitter.addListener(
  "{{MODULE_NAME_PASCAL}}:change",
  (state) => {
    console.log("[{{MODULE_NAME_PASCAL}}] update", state);
  }
);
```

### Initialization

- Module's `initialize(with:)` called after bundle load
- Must register the bridge so `constantsToExport` is visible
- Should publish initial state via `{{MODULE_NAME_PASCAL}}:change` when ready

## Common Patterns

### Window/View Detection (iOS)

```swift
private func getActiveWindow() -> UIWindow? {
  if #available(iOS 13.0, *) {
    return UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .first { $0.activationState == .foregroundActive }?
      .windows
      .first { $0.isKeyWindow }
  }
  return UIApplication.shared.keyWindow
}
```

### State Updates with Coalescing

```swift
private var pendingUpdate = false

private func scheduleUpdate() {
  guard !pendingUpdate else { return }
  pendingUpdate = true

  DispatchQueue.main.async { [weak self] in
    self?.pendingUpdate = false
    self?.updateState(force: false)
  }
}
```

## Troubleshooting

**Module not found at runtime:**

- Verify `zynthNative.ios.initializer.className` matches Swift class name
- Check iOS selector: `initialize(with:)` becomes `initializeWith:`
- Ensure `-ObjC` flag in project.yml if using categories

**State not updating:**

- Check console for native logs: `[YourModule] Publishing state to JS`
- Verify JS interface installed: `globalThis.__YOUR_MODULE__` exists
- Ensure Provider wraps your component tree

**Reactivity broken:**

- Never destructure signal/accessor returns
- Always call accessors: `state()` not `state`
- Use `createMemo` for derived values

## Documentation

See `docs/new-native-module.md` for comprehensive guide covering:

- Native module architecture
- iOS and Android implementation patterns
- SolidJS integration best practices
- Build configuration
- Testing checklist
