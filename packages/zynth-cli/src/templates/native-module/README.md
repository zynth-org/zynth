# Zynth Native Module Template

A minimalist template for creating Zynth native modules with support for Android and iOS.

## Structure

- `android/`: Native Android implementation (Kotlin).
- `ios/`: Native iOS implementation (Swift).
- `src/`: TypeScript interface using `@zynthjs/core` utilities.

## Native Module API

Zynth Core provides a standardized API for creating modules that work on both platforms and are accessed via type-safe helpers in JS.

### JavaScript Usage

Instead of accessing globals directly, use the `@zynthjs/core` helpers.

```typescript
import {
  callNative,
  callNativeSync,
  getNativeModule,
  unwrapNativeResult
} from "@zynthjs/core";

// 1. Asynchronous Call (via Bridge)
async function fetchData() {
  const result = await callNative("MyModule", "getData", { id: 123 });
  return unwrapNativeResult(result);
}

// 2. Synchronous Call (via Bridge)
function getSyncData() {
  const result = callNativeSync("MyModule", "getSyncData");
  return unwrapNativeResult(result);
}

// 3. Direct JSI Access (High Performance)
// Use this for modules that install themselves directly onto the global object
const myJSIModule = getNativeModule<MyJSIInterface>("__MyJSIModule");
```

### iOS Implementation (Swift)

Create a Swift class that conforms to `ZynthModule` (and optionally `ZynthSyncModule`).

```swift
import Foundation
import ZynthKit

@objc(MyModule)
class MyModule: NSObject, ZynthModule, ZynthSyncModule {
  let name = "MyModule"
  
  // Optional: Export constants to JS (available via NativeConstants.MyModule)
  var constantsToExport: [String: Any]? {
    ["apiKey": "12345"]
  }

  func initialize() {
    // Called when module is registered
  }

  func invalidate() {
    // Called when runtime is destroyed
  }

  // Handle Async Calls
  func call(method: String, args: Any?) throws -> Any? {
    switch method {
    case "getData":
      // ... logic ...
      return ["result": "some data"]
    default:
      return nil // or throw error
    }
  }
  
  // Handle Sync Calls
  func callSync(method: String, args: Any?) throws -> Any? {
    switch method {
    case "getSyncData":
      return ["value": 42]
    default:
      throw ZynthModuleError.syncNotSupported(module: name, method: method)
    }
  }
}
```

**Registration:**
In your `ZynthAPIs` or module package initializer:

```swift
@objc public static func initialize(with runtime: ZynthRuntime) {
  let myModule = MyModule()
  runtime.installModules([myModule])
}
```

### Android Implementation (Kotlin)

Create a Kotlin class that implements `ZynthModule` (and optionally `ZynthSyncModule`).

```kotlin
package com.example.mymodule

import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthSyncModule
import org.json.JSONObject

class MyModule : ZynthModule, ZynthSyncModule {
  override val name = "MyModule"

  override val constants: Map<String, Any>?
    get() = mapOf("apiKey" to "12345")

  override fun initialize() {
    // Module setup
  }

  override fun invalidate() {
    // Cleanup
  }

  override fun call(method: String, args: Array<Any?>): JSONObject {
    return when (method) {
      "getData" -> JSONObject().put("result", "some data")
      else -> JSONObject().put("error", "unknown_method")
    }
  }

  override fun callSync(method: String, args: Array<Any?>): Any? {
    return when (method) {
      "getSyncData" -> 42
      else -> null
    }
  }
}
```

**Registration:**
In your package initializer:

```kotlin
fun initialize(runtime: ZynthRuntime) {
  val myModule = MyModule()
  runtime.installModules(listOf(myModule))
}
```
