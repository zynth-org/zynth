# Rune Android Framework - Cleanup Roadmap

## Overview

This document identifies all Rhino-related code and potential optimizations in the Rune Android framework. Rhino was previously used as a JavaScript runtime engine but has been superseded by Hermes. This roadmap aims to help modernize the codebase by removing legacy code and consolidating implementation.

**Generated:** October 22, 2025  
**Target:** FlatList performance optimization and codebase simplification

---

## Table of Contents

1. [Rhino-Related Code to Remove](#rhino-related-code-to-remove)
2. [Code Flow Documentation](#code-flow-documentation)
3. [Optimization Opportunities](#optimization-opportunities)
4. [Cleanup Priority](#cleanup-priority)

---

## Rhino-Related Code to Remove

### 1. **RhinoAdapter.kt** - Full File Removal

**Location:** `/packages/rune-android/android/RuneKit/src/main/java/com/rune/kit/runtime/RhinoAdapter.kt`

**Status:** ⚠️ DEPRECATED - Can be removed

**Imports to remove:**

```kotlin
import org.mozilla.javascript.BaseFunction
import org.mozilla.javascript.Context
import org.mozilla.javascript.Function
import org.mozilla.javascript.NativeJSON
import org.mozilla.javascript.NativeObject
import org.mozilla.javascript.Scriptable
import org.mozilla.javascript.ScriptableObject
import org.mozilla.javascript.Undefined
```

**Class Details:**

- Extends `JSRuntimeAdapter`
- Manages Rhino JavaScript context (`Context.enter()`)
- Provides JavaScript evaluation, global functions, and JSON parsing using Rhino's engine
- Methods:
  - `setGlobalObject(name, value)` - Register objects in JS scope
  - `setGlobalFunction(name, fn)` - Register Kotlin functions as JS functions
  - `evaluate(code)` - Execute JavaScript source code
  - `callGlobal(name, args)` - Call registered global functions
  - `callFunction(fn, args)` - Call JavaScript functions
  - `parseJson(json)` - Parse JSON using Rhino's NativeJSON
  - `createObject(map)` - Create JavaScript objects from Kotlin maps

**Why it exists:** Fallback runtime engine before Hermes was fully integrated

**Can safely remove:** ✅ YES - Hermes is now the primary runtime

---

### 2. **RuneRuntime.kt** - Rhino-Related Methods

**Location:** `/packages/rune-android/android/RuneKit/src/main/java/com/rune/kit/runtime/RuneRuntime.kt`

**Methods to remove:**

#### a) `installRhinoGlobals(rhino: RhinoAdapter)` (Lines 277-365)

- Registers `setTimeout`, `clearTimeout` implementations using handlers
- Provides Promise polyfill for Rhino environment
- Sets `__RUNE_PLATFORM = "android"` platform detection

**Reasoning:** Hermes provides native implementations; Promise support not needed if Hermes handles it

**Lines:** ~89 lines of Rhino-specific code

#### b) `installRhinoBridge(rhino: RhinoAdapter)` (Lines 367-439)

- Registers `__ui_*` functions for Rhino runtime:
  - `__ui_createNode`
  - `__ui_setProp`
  - `__ui_setText`
  - `__ui_insertChild`
  - `__ui_removeChild`
  - `__ui_setHandler`
  - `__ui_flush`
- Registers `__modules_call` for module invocation
- Uses `rhino.parseJson()` for JSON handling

**Reasoning:** Hermes has native JSBridge bindings; Rhino bridge is redundant

**Lines:** ~73 lines of Rhino-specific code

#### c) `HandlerRef.Rhino` sealed class variant (Line 587)

- Stores Rhino `Function` references for event handlers

```kotlin
data class Rhino(val function: Function) : HandlerRef()
```

**Reasoning:** Only needed when Rhino was active; Hermes uses handler IDs

**Where used:**

- Line 404: `handlerMap[id to name] = HandlerRef.Rhino(fn)`
- Line 471: `handler is HandlerRef.Rhino && runtimeAdapter is RhinoAdapter ->`

#### d) Conditional logic checking for `RhinoAdapter` (Multiple locations)

- Line 78-80: In `configureAdapter()` - when statement for RhinoAdapter
- Line 141: In `reloadJavaScript()` - recreates RhinoAdapter if it was previous runtime
- Line 471: In `dispatchHandler()` - checks if handler is Rhino type
- Line 436: Uses `rhino.parseJson()` for module call results

**Lines affected:** ~20 lines across multiple functions

#### e) Import of `org.mozilla.javascript.Function` (Line 26)

- Only needed for Rhino function type checking
- Can be removed with RhinoAdapter removal

---

### 3. **build.gradle.kts** - Rhino Dependency

**Location:** `/packages/rune-android/android/RuneKit/build.gradle.kts` (Line 81)

```kotlin
implementation("org.mozilla:rhino:1.7.14")
```

**Size Impact:** ~1.5-2 MB JAR file

**Can safely remove:** ✅ YES - Hermes is the only runtime now

---

### 4. **RuneBridge.kt** - Rhino Fallback Bridge

**Location:** `/packages/rune-android/android/RuneKit/src/main/java/com/rune/kit/runtime/RuneBridge.kt`

**Status:** ⚠️ PARTIALLY DEPRECATED

**Notes:** This file serves as a fallback bridge when native JNI bindings aren't available. It's used by both Rhino and Hermes, so it should be kept BUT:

- The `installFallback()` method creates Kotlin lambda bridges for `__ui` operations
- This was a critical path for Rhino but is now only used as emergency fallback
- Can be optimized/cleaned when native bindings are guaranteed

---

## Code Flow Documentation

### Example 1: Creating a Text Node

This example traces the complete flow of creating a simple `<Text>Hello</Text>` component from JavaScript to the Android UI.

#### Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ JAVASCRIPT (SolidJS)                                            │
│ <Text>Hello</Text>                                              │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│ HERMES RUNTIME BRIDGE (JNI/C++)                                 │
│ Bridge.cpp: invokeUI("createNode", "text")                      │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│ KOTLIN JSBridge                                                 │
│ JSBridge.UIShim.createNode("text")                              │
│ (routes through Hermes installBindings)                         │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│ RuneRuntime                                                     │
│ installHermesBindings() creates UIShim object                   │
│ UIShim delegates to manager.createNode(type)                    │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│ RuneUIManager                                                   │
│ createNode("text") - Line ~853                                  │
│ Creates Node data structure with:                               │
│ - nodeId (auto-incremented from nextId)                         │
│ - type = "text"                                                 │
│ - parent, children, properties                                  │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│ RuneUIManager - View Creation                                   │
│ Based on type, creates appropriate Android View:                │
│ - "text" → RuneTextInputView / TextView                         │
│ - Adds to nodes SparseArray                                     │
│ - Stores in parents HashMap                                     │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│ RootView (RuneRootView)                                         │
│ Returns newly created nodeId to JavaScript                      │
└─────────────────────────────────────────────────────────────────┘
```

#### Step-by-Step Method Calls

**Step 1: JavaScript calls createNode**

```javascript
// In SolidJS/Rune framework (JSX gets compiled to)
const textNodeId = __ui.createNode("text");
```

**Step 2: Hermes Bridge (C++ → Kotlin)**

File: `Bridge.cpp` (lines 1397-1469 in callGlobal)

- JNI method `Java_com_rune_kit_runtime_JSBridge_callGlobal()` receives the call
- Unmarshals arguments from JNI
- Calls the registered Hermes host function

**Step 3: JSBridge UIShim Interface**

File: `JSBridge.kt` (lines 32-44)

```kotlin
interface UIShim {
    fun createNode(type: String): Int
    fun setProp(nodeId: Int, name: String, jsonValue: String?)
    fun setText(nodeId: Int, text: String)
    // ... other methods
}
```

**Step 4: RuneRuntime Creates UIShim**

File: `RuneRuntime.kt` (lines 489-529)

```kotlin
private fun installHermesBindings(hermes: HermesAdapter) {
    val uiShim = object : JSBridge.UIShim {
        override fun createNode(type: String): Int =
            manager.createNode(type)  // Delegates to UIManager
        // ... other overrides
    }
    hermes.installBindings(uiShim, modulesShim)
}
```

**Step 5: RuneUIManager Creates Node**

File: `RuneUIManager.kt` (lines 853-1013)

```kotlin
override fun createNode(type: String): Int = onMain {
    val nodeId = nextId++
    val node = Node(
        id = nodeId,
        type = type,
        view = when (type) {
            "text" -> RuneTextInputView(root.context)
            "view" -> FrameLayout(root.context)
            "image" -> ImageView(root.context)
            "button" -> RuneButtonView(root.context)
            // ... more types
            else -> FrameLayout(root.context)
        },
        // ... other properties
    )
    nodes.put(nodeId, node)
    parents[nodeId] = null  // root node initially
    nodeId
}
```

**Step 6: Return to JavaScript**

```javascript
const textNodeId = 2; // Example ID returned from native
```

---

### Example 2: Setting Text Content

Flow for: `<Text>Hello</Text>` → setting "Hello" as text content

#### Call Chain

```
JavaScript: __ui.setText(nodeId, "Hello")
    ↓
HermesAdapter.emitEvent() / Bridge.cpp
    ↓
JSBridge.UIShim.setText(nodeId, "Hello")
    ↓
RuneRuntime UIShim implementation
    ↓
RuneUIManager.setText(nodeId, "Hello")
    ↓
applySetText(nodeId, "Hello")
    ↓
RuneTextInputView / TextView.setText("Hello")
    ↓
Yoga Layout Engine recalculation
```

#### Detailed Implementation

**File: `RuneUIManager.kt` - setText (lines 623-658)**

```kotlin
override fun setText(nodeId: Int, text: String) {
    // Queue text setting operation
    pendingNativeOperations.add(
        NativeOperation.SetText(nodeId, text)
    )
    scheduleFlush()
}

private fun applySetText(nodeId: Int, text: String) {
    val node = nodes[nodeId] ?: return

    // For text input views
    if (node.view is RuneTextInputView) {
        node.view.setText(text)
    }

    // For virtual text nodes (children of text container)
    if (isVirtualTextNode(node)) {
        propagateTextChange(node)
    }

    // Schedule text rebuild if node is parent
    pendingTextRebuild.add(nodeId)

    // Trigger layout recalculation
    engine.invalidateLayout(nodeId)
}
```

---

### Example 3: Setting Properties (with Style)

Flow for: `<Text style={{ color: 'red', fontSize: 16 }}>...</Text>`

#### Call Chain

```
JavaScript: __ui.setProp(nodeId, "style", JSON.stringify({color: 'red', fontSize: 16}))
    ↓
Bridge.cpp unmarshals JSON string
    ↓
JSBridge.UIShim.setProp(nodeId, "style", "{\"color\":\"red\",\"fontSize\":16}")
    ↓
RuneUIManager.setProp(nodeId, "style", jsonString)
    ↓
applySetProp(nodeId, "style", jsonString)
    ↓
Parse JSON → Style object
    ↓
Apply to appropriate view (RuneTextInputView)
    ↓
Request layout recalculation (Yoga)
```

#### Implementation Details

**File: `RuneUIManager.kt` - applySetProp (lines 188-620)**

This is the **largest method** in RuneUIManager (~430 lines) that handles:

1. **Style parsing** - converts JSON to `Style` object
2. **Conditional application** based on node type:
   - TextInput-specific: `handleTextInputProp()`
   - General views: color, background, borders, dimensions, etc.
   - Button-specific: `applyStyleToButton()`
3. **View updates**:
   - Background colors and gradients
   - Corner radius and border styles
   - Padding and margins
   - Text color and font properties
   - Accessibility attributes

**Example subset (color handling):**

```kotlin
"color" -> {
    if (node.view is RuneTextInputView) {
        val color = parseColorValue(value)
        color?.let {
            node.view.setTextColor(it)
            node.style.color = it
        }
    }
}
```

---

### Example 4: Event Handling (Button Press)

Flow for: `<Button onPress={() => console.log('pressed')} />`

#### Call Chain

```
JavaScript: __ui.setHandler(nodeId, "onPress", functionReference)
    ↓
Bridge.cpp stores function reference with handler ID
    ↓
JSBridge.UIShim.setHandler(nodeId, "onPress", handlerId)
    ↓
RuneRuntime stores in handlerMap[nodeId to "onPress"] = HandlerRef.Hermes(handlerId)
    ↓
RuneUIManager.setHandler() records the handler
    ↓
User taps button
    ↓
RuneButtonView / RunePressableView detects press
    ↓
Calls listener.onPress(nodeId)
    ↓
RuneUIManager.dispatchEvent(nodeId, "onPress")
    ↓
Bridge.cpp: invokeHandler(handlerId, nodeId, "onPress")
    ↓
Hermes Runtime calls original JavaScript function
    ↓
console.log('pressed') executes
```

#### Implementation Details

**File: `RuneUIManager.kt` - setHandler (lines 661-707)**

```kotlin
override fun setHandler(nodeId: Int, event: String, handlerId: Long) {
    val node = nodes[nodeId] ?: return

    // Store handler reference for later invocation
    when (node.view) {
        is RuneButtonView -> node.view.setListener(this)
        is RunePressableView -> node.view.setListener(this)
        is RuneTextInputView -> {
            when (event) {
                "onChangeText" -> {/* setup listener */}
                "onFocus" -> {/* setup listener */}
                "onBlur" -> {/* setup listener */}
            }
        }
    }

    // Notify runtime of handler attachment
    handlerListener(nodeId, event, handlerId)
}
```

**File: `RuneUIManager.kt` - dispatchHandler (lines 465-487)**

```kotlin
private fun dispatchHandler(id: Int, name: String) {
    val key = id to name
    val handler = handlerMap[key]
    when {
        handler is HandlerRef.Hermes && runtimeAdapter is HermesAdapter -> {
            runtimeAdapter.invokeHandler(handler.handlerId, id, name)
        }
        // Legacy Rhino path (can be removed)
        handler is HandlerRef.Rhino && runtimeAdapter is RhinoAdapter -> {
            val event = runtimeAdapter.createObject(eventPayload)
            runtimeAdapter.callFunction(handler.function, arrayOf(event))
        }
    }
}
```

---

### Example 5: View Tree Insertion

Flow for: building parent-child relationships

#### Call Chain

```
JavaScript: __ui.insertChild(parentId, childId, index)
    ↓
JSBridge.UIShim.insertChild(parentId, childId, index)
    ↓
RuneUIManager.insertChild(parentId, childId, index)
    ↓
Update parents HashMap[childId] = parentId
    ↓
Add childId to Node.children list
    ↓
Add Android View as child of parent View (FrameLayout)
    ↓
Request layout recalculation
```

**File: `RuneUIManager.kt` - insertChild flow:**

1. Queue `ViewOperation.Insert` operation
2. In `processPendingViewOperations()`:
   - Get parent and child node references
   - Call `parentNode.view.addView(childNode.view, index)`
   - Update `parents[childId] = parentId`
   - Update node's children list
3. Yoga layout engine recalculates dimensions

---

## Optimization Opportunities

### High Priority (Performance Impact)

#### 1. **Reduce RuneUIManager.kt Size (~2400 lines)**

**Current Structure:**

- Single file with 40+ public/private methods
- Monolithic `applySetProp` (430 lines)
- Mixed concerns: parsing, validation, application

**Recommended Refactoring:**

Split into focused classes:

```
RuneUIManager.kt (refactored)
├── NodeManager.kt - Node lifecycle (create, remove)
├── StyleApplier.kt - Style parsing & application
├── EventHandler.kt - Event registration & dispatch
├── TextManager.kt - Text-specific operations
├── LayoutManager.kt - Yoga integration
└── ViewOperationQueue.kt - Batch operations
```

**Estimated Savings:**

- 20-30% reduction in method complexity
- Easier to optimize individual concerns
- Better testability for FlatList performance

#### 2. **Remove Rhino Dependency Chain**

**Current Dependency Graph:**

```
build.gradle.kts
└── org.mozilla:rhino:1.7.14 (1.5-2 MB)
    ├── RhinoAdapter.kt (not used)
    └── mozilla.javascript imports (multiple files)
```

**Impact:**

- Removes ~2 MB from APK size
- Eliminates unused reflection in org.mozilla.javascript
- Simplifies build configuration

**Action Items:**

1. Remove `implementation("org.mozilla:rhino:1.7.14")` from build.gradle.kts
2. Delete RhinoAdapter.kt
3. Remove mozilla.javascript imports from RuneRuntime.kt
4. Remove conditional logic for RhinoAdapter in:
   - `configureAdapter()` (lines 78-80)
   - `reloadJavaScript()` (line 141)
   - `dispatchHandler()` (line 471)

#### 3. **Consolidate Bridge Implementations**

**Current State:**

- HermesAdapter: Uses native JNI bindings (optimal)
- RuneBridge: Provides fallback Kotlin implementation
- RhinoAdapter: Legacy JavaScript runtime (removable)

**Issue:** Multiple code paths for same operations

**Recommendation:**

- Ensure Hermes always available (or native fallback only)
- Remove Rhino conditional paths
- Use `@Deprecated` annotations with timeline for removal

#### 4. **Optimize FrameScheduler**

**Current Implementation:** (`FrameScheduler.kt`)

- Batches operations to next frame
- Single callback per frame (good)

**Optimization Opportunity:**

- Profile if frame rate limiting helps or hurts FlatList scrolling
- Consider priority levels (HIGH/NORMAL already present but underused)
- Investigate if aggressive batching causes perceived lag

#### 5. **Profile Handler Dispatch Overhead**

**Current Path (8+ function calls for simple button press):**

```
User Press
→ RuneButtonView.onPress()
→ RunePressableView.Listener.onPress()
→ RuneUIManager.dispatchEvent()
→ Run on main thread
→ handlerMap lookup
→ HermesAdapter.invokeHandler()
→ Bridge.cpp
→ Hermes Runtime
→ JavaScript function
```

**Optimization Opportunities:**

- Cache handler lookup results
- Use SparseArray instead of HashMap for better cache locality
- Profile JNI call overhead

---

### Medium Priority (Code Cleanliness)

#### 1. **Document Private Methods**

**Areas needing documentation:**

- `applySetProp()` - complex style parsing logic
- `handleTextInputProp()` - special text input handling
- `processPendingViewOperations()` - batch operation logic
- `processNativeOperations()` - timing-sensitive operations

**Benefit:** Easier for future developers to optimize without breaking functionality

#### 2. **Extract Color Parsing**

**Current:** Embedded in `parseColorValue()` (lines 1037-1074)

**Optimization:**

```kotlin
// Create ColorUtils.kt
object ColorUtils {
    fun parseColor(rawValue: Any?): Int? { /* ... */ }
    fun parseGradient(colors: List<Int>, positions: FloatArray?): GradientDrawable { /* ... */ }
}
```

#### 3. **Reduce Reflection Usage**

**Current locations:**

- `parseColorValue()` uses reflection on GradientDrawable
- RhinoAdapter type conversions

**Impact:** Each reflection call has ~1-5μs overhead

#### 4. **Consolidate TextInput State Management**

**Current:** `TextInputState` data class + state map

**Issue:** Multiple state lookups per operation

**Opportunity:** Cache state more aggressively, reduce HashMap queries

---

### Low Priority (Technical Debt)

#### 1. **Remove Legacy Imports**

```kotlin
// Remove these mozilla.javascript imports:
import org.mozilla.javascript.Function
// From RuneRuntime.kt
```

#### 2. **Simplify Conditional Logic**

Replace:

```kotlin
when {
    handler is HandlerRef.Rhino && runtimeAdapter is RhinoAdapter -> { }
    handler is HandlerRef.Hermes && runtimeAdapter is HermesAdapter -> { }
}
```

With:

```kotlin
handler as? HandlerRef.Hermes?.let {
    (runtimeAdapter as? HermesAdapter)?.invokeHandler(it.handlerId, id, name)
}
```

#### 3. **Standardize Error Handling**

Different error handling patterns across:

- HermesAdapter
- RhinoAdapter (to be removed)
- RuneUIManager
- RuneBridge

---

## Cleanup Priority

### Phase 1: Immediate Cleanup (Week 1)

**Status:** 🟢 Safe to implement immediately

1. ✅ Remove `RhinoAdapter.kt` entirely
2. ✅ Remove Rhino dependency from `build.gradle.kts`
3. ✅ Remove mozilla.javascript imports from `RuneRuntime.kt`
4. ✅ Remove `HandlerRef.Rhino` sealed class variant
5. ✅ Clean up conditional logic for RhinoAdapter checks

**Files Modified:**

- Delete: `RhinoAdapter.kt`
- Modify: `build.gradle.kts` (remove Rhino dependency)
- Modify: `RuneRuntime.kt` (remove Rhino-related methods and imports)

**Testing Required:**

- ✅ Verify Hermes initialization works
- ✅ Test button press events
- ✅ Test text rendering
- ✅ Test module invocation

**Estimated APK Size Reduction:** ~1.5-2 MB

### Phase 2: Method Consolidation (Week 2-3)

**Status:** 🟡 Requires testing for performance regressions

1. Remove `installRhinoGlobals()` method
2. Remove `installRhinoBridge()` method
3. Consolidate setTimeout/Promise handling into Hermes path only
4. Simplify `configureAdapter()` to only handle Hermes and fallback

**Files Modified:**

- `RuneRuntime.kt` (~150 lines removed)

**Testing Required:**

- ✅ setTimeout/setInterval still work
- ✅ Event dispatch unchanged
- ✅ No performance regression

### Phase 3: Structural Refactoring (Week 3-4)

**Status:** 🟡 Requires careful testing, potential for FlatList optimization

1. Split `RuneUIManager.kt` into focused classes
2. Extract style parsing logic
3. Optimize handler dispatch
4. Profile FlatList scrolling performance

**Files Modified:**

- `RuneUIManager.kt` (refactor)
- Create: `StyleApplier.kt`, `TextManager.kt`, etc.

**Testing Required:**

- ✅ All UI operations work correctly
- ✅ Performance metrics (FPS, memory, render time)
- ✅ Stress test with large lists

**Potential Performance Gain:** 10-20% improvement in FlatList scrolling

### Phase 4: Documentation & Polish (Week 4)

**Status:** 🟢 Non-breaking

1. Add comprehensive method documentation
2. Update architecture documentation
3. Add performance profiling notes
4. Create optimization guide for developers

---

## Files Involved

### Files to Delete

- ✅ `/packages/rune-android/android/RuneKit/src/main/java/com/rune/kit/runtime/RhinoAdapter.kt`

### Files to Modify

- `build.gradle.kts` - Remove Rhino dependency
- `RuneRuntime.kt` - Remove Rhino-related methods
- `RuneUIManager.kt` - (Optional) Refactor for optimization

### Files That Import Removed Code

- `RuneRuntime.kt` - imports `RhinoAdapter`, mozilla.javascript classes
- Build configuration references Rhino

### Files to Keep

- ✅ `HermesAdapter.kt` - Primary runtime
- ✅ `JSBridge.kt` - JNI interface
- ✅ `RuneBridge.kt` - Emergency fallback
- ✅ `RuneUIManager.kt` - Core UI logic

---

## Summary

| Aspect                      | Details                              |
| --------------------------- | ------------------------------------ |
| **Total Lines to Remove**   | ~600+ lines                          |
| **Files to Delete**         | 1 file                               |
| **Dependencies to Remove**  | 1 dependency (~2 MB)                 |
| **Performance Impact**      | 🟢 Slightly better (less reflection) |
| **Risk Level**              | 🟢 LOW (already using Hermes)        |
| **APK Size Reduction**      | ~1.5-2 MB                            |
| **Estimated Effort**        | 2-4 weeks (4 phases)                 |
| **Potential FlatList Gain** | 10-20% (phase 3+)                    |

---

## References

- Bridge.cpp: JNI layer for Hermes
- JSBridge.kt: UIShim/ModulesShim interfaces
- HermesAdapter.kt: Hermes runtime implementation
- RuneUIManager.kt: Core UI management
- FrameScheduler.kt: Operation batching
