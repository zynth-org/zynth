# Native Component Package Creation Guide (iOS & Android)

> **Goal:** Document the architecture and workflow for authoring **new** standalone component packages that ship native (iOS/Android) artifacts for the Rune framework. This guide serves as the primary "golden path" for creating new UI components.

## 1. Background and Philosophy

1.  The Rune framework is designed for modularity. While the core platforms (`@rune/ios`, `@rune/android`) provide essential APIs and registries, all UI components are developed as standalone packages.
2.  Each component package now ships **JS/TS (SolidJS) code** plus the **native iOS/Android implementation** and registers itself with the host platform during the CLI prebuild step.
3.  Core platforms expose minimal hooks (component registries, node abstractions, prop setters) so that external packages can plug in without patching the host.
4.  This "host-and-plugin" model allows the ecosystem to grow with independently published and versioned components, mirroring modern React Native and Expo community modules.

## 2. Terminology

| Term                       | Meaning                                                                                                               |
| :------------------------- | :-------------------------------------------------------------------------------------------------------------------- |
| **Host**                   | The platform package (`@rune/ios` / `@rune/android`) that exposes registries, node APIs, layout engine, etc.          |
| **Component Package**      | A workspace (e.s., `@rune/my-new-component`) that exports TS primitives and embeds native folders (`ios`, `android`). |
| **Descriptor / Registrar** | Structures used by native registries to create views, apply props, and hook events for custom components.             |
| **Prebuild**               | CLI command (`rune prebuild <platform>`) that scaffolds native projects and links component pods/modules.             |

## 3. High-Level Creation Checklist

1.  Define the component's JS/SolidJS API in the new package's `src` directory.
2.  Scaffold the native iOS implementation (UIView, descriptor, podspec) in the `ios` directory.
3.  Scaffold the native Android implementation (View, descriptor, Gradle module) in the `android` directory.
4.  Add the `runeNative` metadata to the component's `package.json` so the CLI can discover it.
5.  Implement the prop/event handling logic in both native descriptors.
6.  Run `rune prebuild` in a demo app to link the new package.
7.  Build, test, and validate the new component on both platforms.

## 4. iOS Architecture Overview

1.  **Registry:** `RuneComponentDescriptor` and `RuneComponentRegistry` (Objective-C) allow packages to register components with creation, attachment, prop handling, and handler setup callbacks.
2.  **SNNode exposure:** `SNNode` is public so components can access the backing view and metadata.
3.  **Host integration:** `SNUIManager` consults the registry every time `createNode(type)` is called. If a descriptor exists, it creates the view via `descriptor.createView`.
4.  **Prop routing:** `SNUIManager` first gives descriptors a chance to handle properties and handlers; only unhandled props fall back to legacy logic.
5.  **Lifecycle:** During node attach / detach, descriptors can hook into the `SNNode` to manage delegates, pointer events, accessibility, etc.

## 5. Android Architecture Overview

1.  **Registry:** Kotlin counterpart `RuneComponentRegistry` lives inside `RuneKit`. Descriptors register via `RuneComponentRegistrar` implementations discovered by `ServiceLoader`.
2.  **Interfaces:** Event listener interfaces (e.g., `RunePressableEventListener`) allow components to signal events back to the host manager (`RuneUIManager`).
3.  **Node Factory:** `RuneNodeFactory` queries the registry while creating nodes. Custom components provide the view instance and attach callbacks to the manager.
4.  **Prop Applier:** `RunePropApplier` gives descriptors first dibs on handling properties and handlers before default switch logic.
5.  **Recycling:** Component descriptors receive reset hooks so pooled nodes are cleaned when reused by lists.

## 6. Metadata (`package.json`) Schema

This `runeNative` key is mandatory for the CLI to link your native code.

### Component Packages (Auto-Registration via +load)

For UI components that use Objective-C categories with `+load` methods (auto-register on pod link):

```json
"runeNative": {
  "ios": {
    "pods": [
      { "name": "MyRuneComponent", "podspec": "./MyRuneComponent.podspec" }
    ]
  },
  "android": {
    "modules": [
      { "name": "MyRuneComponent", "path": "./android/MyRuneComponent" }
    ]
  }
}
```

### Native Module Packages (Manual Initialization)

For modules that need explicit initialization after bundle load (e.g., platform APIs, device sensors):

```json
"runeNative": {
  "ios": {
    "pods": [
      { "name": "RuneMyModule", "podspec": "./RuneMyModule.podspec" }
    ],
    "initializer": {
      "className": "MyModuleClass",
      "method": "initializeWith:"
    }
  },
  "android": {
    "modules": [
      { "name": "RuneMyModule", "path": "./android/RuneMyModule" }
    ],
    "initializer": {
      "className": "MyModuleClass",
      "method": "initialize"
    }
  }
}
```

**Key Points:**

- `className`: The actual Swift/Kotlin class name (not the pod/module name)
- iOS `method`: The Objective-C selector (Swift method `initialize(with:)` becomes `initializeWith:`)
- Initializers are called automatically after bundle load but before `runtime.start()`

## 7. Native Module Implementation Patterns

### iOS Module with Initialization

When creating a native module that needs explicit initialization:

**Swift Module Class:**

```swift
@objc(MyModuleClass)
public class MyModuleClass: NSObject {
  private weak var runtime: RuneRuntime?
  private var observers: [NSObjectProtocol] = []

  // Internal init - accessible within module
  init(runtime: RuneRuntime) {
    self.runtime = runtime
    super.init()
  }

  // Static initializer called by auto-generated code
  @objc public static func initialize(with runtime: RuneRuntime) {
    print("[MyModule] Initializing module")
    let module = MyModuleClass(runtime: runtime)
    module.installJSInterface()
    module.startObserving()
    print("[MyModule] Module initialized")
  }

  private func installJSInterface() {
    guard let runtime = runtime else { return }

    let code = """
    globalThis.__MY_MODULE__ = {
      // Your module API here
    };
    console.log('[MyModule] Interface installed');
    """

    evaluateJavaScript(code, in: runtime)
  }

  private func evaluateJavaScript(_ code: String, in runtime: RuneRuntime) {
    // Use Mirror reflection to access internal runtime adapter
    let mirror = Mirror(reflecting: runtime)
    for child in mirror.children {
      if child.label == "runtime",
         let adapter = child.value as? JSRuntimeAdapter {
        adapter.evaluate(code: code)
        return
      }
    }
  }

  deinit {
    stopObserving()
  }

  private func startObserving() {
    // Add platform observers as needed
  }

  private func stopObserving() {
    for observer in observers {
      NotificationCenter.default.removeObserver(observer)
    }
    observers.removeAll()
  }
}
```

**Critical Details:**

1. Use `@objc` attribute with explicit name to control Objective-C visibility
2. Static `initialize(with:)` method becomes `initializeWith:` selector
3. Use `weak var runtime` to avoid retain cycles
4. Access internal `RuneRuntime.runtime` via Mirror reflection when needed
5. Install JS interface via `evaluateJavaScript` (requires runtime adapter access)

### Window Detection and Timing

Native modules that observe platform state (keyboard, orientation, device sensors) often need robust window detection:

```swift
private func getActiveWindow() -> UIWindow? {
  // Try key window from active scene
  if #available(iOS 13.0, *) {
    if let keyWindow = UIApplication.shared.connectedScenes
      .compactMap({ $0 as? UIWindowScene })
      .first(where: { $0.activationState == .foregroundActive })?
      .windows
      .first(where: { $0.isKeyWindow }) {
      return keyWindow
    }

    // Fallback: first window in active scene
    if let firstWindow = UIApplication.shared.connectedScenes
      .compactMap({ $0 as? UIWindowScene })
      .first(where: { $0.activationState == .foregroundActive })?
      .windows.first {
      return firstWindow
    }
  }

  // Fallback: legacy key window
  return UIApplication.shared.keyWindow
}

private func startObserving() {
  // Observe when window becomes key
  let windowObserver = NotificationCenter.default.addObserver(
    forName: UIWindow.didBecomeKeyNotification,
    object: nil,
    queue: .main
  ) { [weak self] _ in
    self?.updateState()
  }
  observers.append(windowObserver)

  // Provide initial state immediately
  updateState(force: true)
}
```

**Timing Considerations:**

- Module initialization happens after bundle load but window may not be key yet
- Always publish initial state in `startObserving()` with `force: true`
- Add `UIWindow.didBecomeKeyNotification` observer for late window setup
- Implement multiple fallbacks in window detection for reliability

## 8. SolidJS Integration Patterns

### Context Providers with Accessor Pattern

When creating SolidJS contexts that depend on native updates, use the Accessor pattern:

```typescript
import {
  createContext,
  createSignal,
  useContext,
  type Accessor,
} from "solid-js";

interface ModuleState {
  value: number;
  status: string;
}

// Context stores Accessor, not raw value
const ModuleStateContext = createContext<Accessor<ModuleState>>(() => ({
  value: 0,
  status: "idle",
}));

export function ModuleProvider(props: {
  initialState?: ModuleState;
  children: JSX.Element;
}) {
  const [state, setState] = createSignal<ModuleState>(
    props.initialState ?? { value: 0, status: "idle" }
  );

  createEffect(() => {
    // Subscribe to native updates
    const unsubscribe = globalThis.__MY_MODULE__?.addChangeListener?.(
      (newState: ModuleState) => {
        setState(newState);
      }
    );
    return () => unsubscribe?.();
  });

  return (
    <ModuleStateContext.Provider value={state}>
      {props.children}
    </ModuleStateContext.Provider>
  );
}

// Hook returns Accessor for reactive access
export function useModuleState(): Accessor<ModuleState> {
  return useContext(ModuleStateContext);
}
```

**Critical SolidJS Patterns:**

1. **Never destructure signals** - Always use accessor functions: `state()` not `{value, status}`
2. **Context stores Accessors** - `createContext<Accessor<T>>()` not `createContext<T>()`
3. **Hooks return Accessors** - Consumers call `const state = useModuleState(); state().value`
4. **Use createMemo for derived values** - Preserves reactivity through transformations
5. **Provide initialState** - Enables SSR/initial render with native values before subscription

### Components with Reactive State

When building components that consume reactive context:

```typescript
export const ModuleDisplay: Component<ModuleDisplayProps> = (props) => {
  const merged = mergeProps({ showStatus: true }, props);
  const state = useModuleState();

  // Use createMemo to reactively compute derived values
  const displayText = createMemo(() => {
    const currentState = state();
    return merged.showStatus
      ? `${currentState.status}: ${currentState.value}`
      : `${currentState.value}`;
  });

  // Use createMemo for reactive styles
  const computedStyle = createMemo(() => {
    const baseStyle: Style = {
      opacity: state().value > 0 ? 1 : 0.5,
    };
    return { ...baseStyle, ...(merged.style || {}) };
  });

  return (
    <View style={computedStyle()}>
      <Text>{displayText()}</Text>
    </View>
  );
};
```

**Reactivity Preservation:**

- Call accessor inside `createMemo`: `state().value`
- Return new object from memo - don't mutate existing objects
- Spread operator is safe inside memo: `{ ...baseStyle, ...userStyle }`
- Always invoke accessors when reading: `state()` not just `state`

## 9. iOS Build Configuration

### Linker Flags for Objective-C Categories

When using Objective-C categories (like component descriptors with `+load` methods), the `-ObjC` linker flag is **required**:

**In `project.yml` template:**

```yaml
settings:
  base:
    TARGETED_DEVICE_FAMILY: "1,2"
    LD_RUNPATH_SEARCH_PATHS: "$(inherited) @executable_path/Frameworks"
    OTHER_LDFLAGS: "$(inherited) -ObjC"
```

**Why This Matters:**

- Static libraries don't auto-load Objective-C categories without `-ObjC`
- Component descriptors use categories on `SNUIManager` with `+load` methods
- Without flag: "No descriptor found for type 'button'" warnings
- `$(inherited)` ensures CocoaPods linker flags are preserved

### Common Linker Issues

**Symptom:** `Undefined symbols for architecture arm64: "_OBJC_CLASS_$_ClassName"`

**Solutions:**

1. Verify class name in `package.json` matches actual Swift class name
2. Check podspec includes correct source files
3. Ensure `$(inherited)` in linker flags to get CocoaPods settings
4. Run `pod install` after changing podspec or linking

## 10. Project Generation and Code Templates

### Automatic Module Registration

The `scripts/generate-ios.js` and `scripts/generate-android.js` scripts automatically generate initialization code:

**Template Placeholders:**

```objc
// In AppDelegate.m template
{{MODULE_IMPORTS}}  // Generates: #import "ModuleName-Swift.h"

// After bundle load, before runtime.start()
{{MODULE_INITIALIZERS}}  // Generates: [ClassName method:self.runtime];
```

**Generation Process:**

1. Scans `package.json` dependencies for `runeNative` metadata
2. For each pod/module with `initializer`: generates import and call
3. Replaces placeholders in template files
4. Writes to `apps/{app}/ios/` or `apps/{app}/android/`

**Template Syntax Rules:**

- Use `{{PLACEHOLDER}}` without spaces
- Formatters may add spaces: `{ { PLACEHOLDER } }` breaks generation
- Always regenerate after template changes: `node scripts/generate-ios.js apps/{app}`

## 11. Testing and Validation Checklist

When creating a new native module:

**iOS:**

- [ ] Module class uses `@objc` attribute with explicit name
- [ ] Static initializer method signature matches Obj-C selector in package.json
- [ ] Window detection has multiple fallbacks (if needed)
- [ ] Initial state published in `startObserving()` or initialization
- [ ] Observers cleaned up in `deinit` or `stopObserving()`
- [ ] JS interface injection uses Mirror reflection for runtime access
- [ ] Console logs for initialization steps and state updates
- [ ] Pod installs and links correctly
- [ ] `-ObjC` flag present if using categories

**Android:**

- [ ] Module class has correct package and name
- [ ] Static initializer accessible from Kotlin
- [ ] Lifecycle observers properly registered/unregistered
- [ ] Initial state published after installation
- [ ] Gradle module builds and links

**JavaScript:**

- [ ] Context uses Accessor pattern: `createContext<Accessor<T>>()`
- [ ] Hooks return Accessors, not destructured values
- [ ] Components use `createMemo` for derived reactive values
- [ ] Provider accepts `initialState` for SSR/initial render
- [ ] No destructuring of signal returns
- [ ] Types exported from package entry point

**Build & Runtime:**

- [ ] `yarn rune dev ios/android --prebuild` builds without errors
- [ ] Native logs show module initialization
- [ ] JS logs show interface installation
- [ ] Components render with correct initial values
- [ ] Updates from native propagate to UI
- [ ] HMR works without breaking module state
