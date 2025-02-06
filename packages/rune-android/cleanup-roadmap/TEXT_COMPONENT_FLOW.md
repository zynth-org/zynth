# Text Component Flow - Detailed Implementation Guide

## Complete Call Stack for `<Text>Hello</Text>`

This document provides the complete, step-by-step technical flow for rendering a Text component in Rune, from JavaScript source code to rendered Android view.

---

## 1. JavaScript Layer (SolidJS/JSX)

### Source Code

```tsx
// App.tsx in SolidJS
export default function App() {
  return <Text>Hello</Text>;
}
```

### Compiled Output (Framework generates)

```javascript
// Compiled to Rune IR
{
  type: "Text",
  props: { children: "Hello" },
  children: []
}
```

### Framework Translation to Native Calls

The Rune renderer translates JSX to native UI operations:

```javascript
// Pseudo-code of what Rune framework does:
function renderText(props) {
  const nodeId = __ui.createNode("text"); // Step A
  __ui.insertChild(parentId, nodeId, index); // Step B
  if (props.children) {
    __ui.setText(nodeId, props.children); // Step C
  }
  __ui.flush(); // Step D
  return nodeId;
}
```

---

## 2. JavaScript Bridge Layer

### 2.1 Global Object Registration (RuneRuntime.kt)

**File:** `RuneRuntime.kt` (lines 489-529 for Hermes)

When the runtime initializes, it installs the UI bridge:

```kotlin
private fun installHermesBindings(hermes: HermesAdapter) {
    val uiShim = object : JSBridge.UIShim {
        override fun createNode(type: String): Int =
            manager.createNode(type)

        override fun setText(nodeId: Int, text: String) =
            manager.setText(nodeId, text)

        override fun insertChild(parentId: Int, childId: Int, index: Int) =
            manager.insertChild(parentId, childId, index)

        override fun flush() =
            manager.flush()
        // ... other methods
    }

    // Pass to native JNI layer
    hermes.installBindings(uiShim, modulesShim)
}
```

### 2.2 HermesAdapter Installation (HermesAdapter.kt)

**File:** `HermesAdapter.kt` (lines 89-95)

```kotlin
fun installBindings(
    uiShim: JSBridge.UIShim,
    modulesShim: JSBridge.ModulesShim,
) {
    runOnJS {
        ensureRuntime()
        // Call native JNI method
        bridge.installBindings(runtimePtr, uiShim, modulesShim, timerShim, errorHandler)
    }
}
```

---

## 3. Native JNI Layer (Bridge.cpp)

### 3.1 JNI Method Registration

**File:** `Bridge.cpp` (lines 1265-1324)

The native layer receives the Java objects and stores method references:

```cpp
void installBindings(
    facebook::hermes::HermesRuntime *runtime,
    JNIEnv *env,
    jobject uiShim,           // Java UIShim instance
    jobject modulesShim,       // Java ModulesShim instance
    jobject timerShim,         // Java TimerShim instance
    jobject errorHandler) {    // Java ErrorHandler instance

    auto state = std::make_shared<RuntimeState>();
    state->runtime = runtime;
    state->uiShim = env->NewGlobalRef(uiShim);
    state->uiClass = env->GetObjectClass(uiShim);

    // Store method IDs for later invocation
    state->uiMethods.createNode =
        env->GetMethodID(state->uiClass, "createNode", "(Ljava/lang/String;)I");
    state->uiMethods.setText =
        env->GetMethodID(state->uiClass, "setText", "(ILjava/lang/String;)V");
    state->uiMethods.insertChild =
        env->GetMethodID(state->uiClass, "insertChild", "(III)V");
    state->uiMethods.flush =
        env->GetMethodID(state->uiClass, "flush", "()V");
    // ... more method IDs

    storeState(runtime, state);
}
```

### 3.2 Hermes Global Function Setup

After storing the UIShim reference, the native layer registers JavaScript host functions:

```cpp
// Still in installBindings()

// Create JavaScript function: __ui_createNode = function(type) { ... }
auto createNodeFunc = [](facebook::jsi::Runtime &rt, const facebook::jsi::Value &thisVal,
                        const facebook::jsi::Value *args, size_t count) -> facebook::jsi::Value {
    auto state = getState((facebook::hermes::HermesRuntime *)&rt);
    if (!state) return facebook::jsi::Value::null();

    std::string type = args[0].asString(rt).utf8(rt);
    JniEnv je;

    // Call Java UIShim.createNode(type)
    jint nodeId = je.env()->CallIntMethod(
        state->uiShim,
        state->uiMethods.createNode,
        je.env()->NewStringUTF(type.c_str())
    );

    return facebook::jsi::Value(static_cast<double>(nodeId));
};

runtime->global().setProperty(
    runtime,
    "__ui_createNode",
    facebook::jsi::Function::createFromHostFunction(runtime, ..., createNodeFunc)
);

// Similar setup for __ui_setText, __ui_insertChild, __ui_flush, etc.
```

---

## 4. JavaScript (Hermes Runtime)

### 4.1 Framework Uses Registered Functions

```javascript
// Hermes runtime now has these global functions:
__ui_createNode("text"); // Returns nodeId
__ui_setText(nodeId, "Hello");
__ui_insertChild(parentId, nodeId, index);
__ui_flush();

// Framework wraps these in convenience object:
const __ui = {
  createNode: __ui_createNode,
  setText: __ui_setText,
  insertChild: __ui_insertChild,
  flush: __ui_flush,
  // ... others
};

// Application code calls:
__ui.createNode("text");
```

---

## 5. Kotlin JSBridge Layer (RuneRuntime.kt)

### 5.1 HermesAdapter.invokeHandler Pattern

When JavaScript calls `__ui_createNode`, the native bridge invokes the Kotlin UIShim:

**File:** `RuneRuntime.kt` (lines 489-529)

```kotlin
// The uiShim object created earlier gets invoked:
override fun createNode(type: String): Int {
    // This method is called from JNI when JS calls __ui_createNode
    return manager.createNode(type)
}
```

The JNI layer calls back to Kotlin:

**File:** `Bridge.cpp` (pseudocode)

```cpp
// Inside the host function for __ui_createNode:
jint nodeId = je.env()->CallIntMethod(
    state->uiShim,                          // The UIShim object
    state->uiMethods.createNode,            // The method reference
    je.env()->NewStringUTF("text")          // "text" argument
);
// Returns: nodeId (e.g., 100)
```

---

## 6. RuneUIManager Layer (RuneUIManager.kt)

### 6.1 createNode - Node Creation

**File:** `RuneUIManager.kt` (lines 853-1013)

```kotlin
override fun createNode(type: String): Int = onMain {
    val nodeId = nextId++  // Auto-incrementing ID, e.g., 100

    // Create the Android View based on type
    val view: View = when (type) {
        "text" -> {
            // For text rendering, create a RuneTextInputView
            RuneTextInputView(root.context).apply {
                // Configure text view properties
                inputType = InputType.TYPE_NULL  // Read-only
                isFocusable = false
                isEditable = false
            }
        }
        "view" -> FrameLayout(root.context)
        "image" -> ImageView(root.context)
        "button" -> RuneButtonView(root.context)
        else -> FrameLayout(root.context)
    }

    // Create data structure to track node
    val node = Node(
        id = nodeId,
        type = type,
        view = view,
        viewNeedsLayout = true,
        paddingLeft = 0,
        paddingRight = 0,
        paddingTop = 0,
        paddingBottom = 0
    )

    // Store in sparse array for quick lookup
    nodes.put(nodeId, node)

    // Initialize parent reference (null for root)
    parents[nodeId] = null

    Log.d("RuneUI", "Created node: type=$type, nodeId=$nodeId")

    nodeId  // Return to JavaScript
}
```

### 6.2 insertChild - Tree Hierarchy

When JavaScript calls `__ui.insertChild(parentId, childId, index)`:

**File:** `RuneUIManager.kt` (lines ~1200-1250, approximate location)

```kotlin
override fun insertChild(parentId: Int, childId: Int, index: Int) {
    val operation = ViewOperation.Insert(parentId, childId, index)
    pendingViewOperations.add(operation)
    scheduleFlush()  // Queue for next frame
}

// During flush, processPendingViewOperations() executes:
private fun processPendingViewOperations() {
    for (operation in pendingViewOperations) {
        when (operation) {
            is ViewOperation.Insert -> {
                val parentNode = nodes[operation.parentId] ?: return
                val childNode = nodes[operation.childId] ?: return

                // Add child view to parent's Android ViewGroup
                if (parentNode.view is ViewGroup) {
                    parentNode.view.addView(
                        childNode.view,
                        operation.index
                    )
                }

                // Update parent tracking
                parents[operation.childId] = operation.parentId

                // Add to children list
                parentNode.children.add(operation.childId)

                // Invalidate layout
                engine.invalidateLayout(operation.parentId)
            }
            // ... other operations
        }
    }
    pendingViewOperations.clear()
}
```

### 6.3 setText - Text Content

When JavaScript calls `__ui.setText(nodeId, "Hello")`:

**File:** `RuneUIManager.kt` (lines 623-658)

```kotlin
override fun setText(nodeId: Int, text: String) {
    val operation = NativeOperation.SetText(nodeId, text)
    pendingNativeOperations.add(operation)
    scheduleFlush()
}

// During flush, processPendingNativeOperations() executes:
private fun processPendingNativeOperations() {
    for (operation in pendingNativeOperations) {
        when (operation) {
            is NativeOperation.SetText -> {
                applySetText(operation.nodeId, operation.text)
            }
            // ... other operations
        }
    }
}

private fun applySetText(nodeId: Int, text: String) {
    val node = nodes[nodeId] ?: return

    // For RuneTextInputView
    if (node.view is RuneTextInputView) {
        node.view.setText(text)
        Log.d("RuneUI", "Set text: nodeId=$nodeId, text=$text")
    }

    // Mark for text rebuild if it's a virtual text node
    if (isVirtualTextNode(node)) {
        pendingTextRebuild.add(nodeId)
        recomputeAndPropagate(node)
    }

    // Trigger layout recalculation
    engine.invalidateLayout(nodeId)
}
```

### 6.4 flush - Batch Operations

**File:** `RuneUIManager.kt` (lines ~702-760, approximate)

```kotlin
override fun flush() {
    // Process all queued operations
    processPendingNativeOperations()
    processPendingViewOperations()

    // Perform layout measurement & positioning
    engine.layout()

    // Apply computed styles to views
    applyComputedLayout()
}
```

---

## 7. Layout Engine (YogaLayoutEngine)

**File:** `YogaLayoutEngine.kt`

After text is set and tree is built, the layout engine calculates dimensions:

```kotlin
fun layout() {
    // Uses Yoga (Facebook's layout engine)
    // Measures each node's content

    // For text nodes:
    // 1. Measure text size using Paint.measureText()
    // 2. Apply to Yoga node
    // 3. Yoga recalculates parent dimensions
    // 4. Returns x, y, width, height for each node
}
```

---

## 8. View Rendering (Android Framework)

### 8.1 Layout Pass

After RuneUIManager has positioned all views:

```kotlin
// Android View System
FrameLayout.onLayout() {
    // Position all child views based on computed x, y, width, height
    childView.layout(left, top, right, bottom)
}
```

### 8.2 Draw Pass

```kotlin
// Android calls draw() on each view
RuneTextInputView.onDraw(canvas) {
    // Renders text using TextPaint
    canvas.drawText(text, x, y, textPaint)
}
```

---

## 9. Complete Execution Timeline

### Timing Breakdown (Typical Values)

| Phase                       | Duration  | Description                                       |
| --------------------------- | --------- | ------------------------------------------------- |
| **JavaScript execution**    | 0.5-1ms   | Framework generates \_\_ui calls                  |
| **JNI boundary crossing**   | 0.1-0.2ms | Transition to native code                         |
| **UIManager.createNode()**  | 0.2-0.5ms | Create View object                                |
| **UIManager.setText()**     | 0.1-0.3ms | Set text content                                  |
| **UIManager.insertChild()** | 0.2-0.4ms | Add view to parent                                |
| **Frame scheduling**        | varies    | Wait for next screen refresh (16.67ms for 60 FPS) |
| **Yoga layout**             | 1-5ms     | Measure & calculate positions                     |
| **Android layout pass**     | 0.5-2ms   | View hierarchy layout                             |
| **Android draw pass**       | 1-3ms     | Canvas rendering                                  |
| **Display refresh**         | 0.1ms     | GPU display update                                |
| **Total (cold)**            | ~20ms     | First frame                                       |
| **Total (warm)**            | ~5-10ms   | Subsequent frames                                 |

### Frame Boundary Example

```
Frame N:
│
├─ 0ms: __ui.createNode("text") queued
├─ 0.5ms: __ui.setText(100, "Hello") queued
├─ 1ms: __ui.flush() called
├─ 2ms: Layout calculation completes
├─ 4ms: Android layout pass completes
│
├─ 16.67ms: VSYNC signal (60 FPS)
│
├─ 16.67ms: Android draw pass
├─ 18ms: Composition to GPU
├─ 19ms: GPU renders to display buffer
├─ 20ms: Display shows new frame

Frame N+1:
```

---

## 10. Code Paths for Different Scenarios

### Scenario A: Creating Multiple Text Nodes

```javascript
__ui.createNode("text"); // nodeId 1
__ui.createNode("text"); // nodeId 2
__ui.createNode("text"); // nodeId 3
__ui.flush(); // All 3 created in batch
```

**Optimized flow:**

- All `createNode` calls queue operations
- Single `flush()` processes all 3 at once
- Yoga layout calculates all at once
- More efficient than 3 separate flushes

### Scenario B: Updating Text Content

```javascript
__ui.setText(nodeId, "Old text");
__ui.setText(nodeId, "New text");
__ui.flush();
```

**Smart batching:**

- Both operations queue
- During flush, second operation overwrites first
- Only "New text" is rendered
- Avoids unnecessary rendering

### Scenario C: Conditional Rendering

```javascript
if (showText) {
  const nodeId = __ui.createNode("text");
  __ui.insertChild(parentId, nodeId, 0);
  __ui.setText(nodeId, "Hello");
}
__ui.flush();
```

**Execution:**

- Conditional creates/inserts/sets only if true
- All operations batched into single flush
- Clean, efficient rendering

---

## 11. Error Handling Flow

### Error During Native Call

```cpp
// If JNI call fails:
jint nodeId = je.env()->CallIntMethod(...);
if (je.env()->ExceptionCheck()) {
    // Exception occurred in Java
    je.env()->ExceptionDescribe();
    je.env()->ExceptionClear();
    // Return error value or handle gracefully
}
```

### Error During Layout

```kotlin
// In RuneUIManager
try {
    engine.layout()
} catch (e: Exception) {
    Log.e("RuneUI", "Layout failed: ${e.message}")
    root.showRedBox(e.message, e.stackTraceToString())
}
```

---

## 12. Performance Considerations

### Current Bottlenecks for FlatList

1. **Main Thread Operations**

   - All View operations must run on main thread via `onMain { }`
   - Creates latency when JavaScript is busy

2. **Layout Calculation**

   - Yoga recalculates entire subtree
   - Large lists cause repeated expensive calculations

3. **Handler Dispatch Overhead**

   - 8+ function calls for simple button press
   - JNI boundary crossing adds latency

4. **TextInput View Creation**
   - Each text node creates full TextInputView
   - More heavyweight than simple TextView

### Optimization Ideas

1. **Reuse Views in FlatList**

   - Detect list patterns
   - Create view pool
   - Rebind nodes instead of recreate

2. **Lazy Layout**

   - Only layout visible items
   - Defer off-screen layout

3. **Reduce Handler Dispatch Latency**

   - Direct handler mapping
   - Batch event processing

4. **Use Lighter Text Components**
   - Option to use simple TextView instead of TextInputView
   - Custom text render path for lists

---

## 13. Key Classes Reference

| Class               | File                 | Purpose                               |
| ------------------- | -------------------- | ------------------------------------- |
| `RuneRuntime`       | RuneRuntime.kt       | Runtime lifecycle, adapter management |
| `HermesAdapter`     | HermesAdapter.kt     | Hermes engine wrapper                 |
| `JSBridge.UIShim`   | JSBridge.kt          | JNI callback interface                |
| `RuneUIManager`     | RuneUIManager.kt     | Node creation, property setting       |
| `RuneTextInputView` | RuneTextInputView.kt | Text rendering view                   |
| `YogaLayoutEngine`  | YogaLayoutEngine.kt  | Layout calculation                    |
| `FrameScheduler`    | FrameScheduler.kt    | Batch operation scheduling            |

---

## Summary

The Text component flow demonstrates how Rune bridges JavaScript and Android:

1. **JavaScript layer** generates UI operations
2. **Bridge.cpp** marshals calls through JNI
3. **Kotlin UIManager** creates and manages Views
4. **Layout engine** calculates dimensions
5. **Android framework** renders to screen

Key optimization areas for FlatList:

- Reduce handler dispatch overhead
- Implement view recycling
- Optimize text rendering
- Batch layout calculations
