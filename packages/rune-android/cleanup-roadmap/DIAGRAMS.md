# Architecture Diagrams & Visual References

## 1. Complete Rendering Pipeline

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    APPLICATION LAYER                                  │
│                  SolidJS Application Code                             │
│                   <Text>Hello</Text>                                  │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│                    FRAMEWORK LAYER                                    │
│           Rune Framework (JSX → IR → Native Calls)                    │
│                                                                       │
│  __ui.createNode("text", nodeId)                                      │
│  __ui.setText(nodeId, "Hello")                                        │
│  __ui.insertChild(parentId, nodeId, 0)                                │
│  __ui.flush()                                                         │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│                 JAVASCRIPT RUNTIME                                    │
│                   Hermes Engine                                       │
│                                                                       │
│  Global functions: __ui_createNode, __ui_setText, etc.               │
│  Registers: Handlers, Module callbacks                                │
│                                                                       │
│  Manages: Timers, Promises, Event loop                                │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       │ JNI Boundary
                       │ (Bridge.cpp)
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│              NATIVE LAYER (C++)                                 │
│           Bridge.cpp - JNI Method Implementations              │
│                                                                 │
│  Marshals: Arguments from JS to Kotlin                         │
│  Stores: Function references, State                            │
│  Calls: UIShim methods via JNI                                 │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│            KOTLIN BRIDGE LAYER                                  │
│              JSBridge.UIShim Interface                          │
│                                                                 │
│  Callbacks from C++: createNode, setText, etc.                 │
│  Delegates to: RuneUIManager                                   │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│            UI MANAGEMENT LAYER                                  │
│              RuneUIManager                                      │
│                                                                 │
│  Node Management: Creation, deletion, tracking                 │
│  View Creation: Creates Android Views                          │
│  Property Application: Sets colors, text, etc.                 │
│  Event Handler: Registers press/change listeners               │
│  Layout: Queues for Yoga calculation                           │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│          LAYOUT ENGINE LAYER                                    │
│           YogaLayoutEngine                                      │
│                                                                 │
│  Measurement: Calculates text size, view dimensions            │
│  Layout: Computes x, y, width, height                          │
│  Invalidation: Marks nodes as needing recalculation            │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│         ANDROID FRAMEWORK LAYER                                 │
│        View System, Measurement, Layout, Draw                  │
│                                                                 │
│  1. onMeasure() - Measure views                                │
│  2. onLayout() - Position views                                │
│  3. onDraw() - Render to canvas                                │
│  4. Invalidate/RequestLayout - Queue changes                   │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│            GPU & DISPLAY                                        │
│        Composition, Rasterization, Display Update              │
│                                                                 │
│  Compose: Layer tree to GPU commands                           │
│  Render: Draw to surface                                       │
│  Display: VSYNC refresh (16.67ms @ 60 FPS)                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. JavaScript Bridge Architecture (Current with Hermes)

```
┌─────────────────────────────────────────────────────────────────┐
│  JavaScript Global Scope                                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ __ui = {                                                 │   │
│  │   createNode(type),                                      │   │
│  │   setProp(id, name, value),                              │   │
│  │   setText(id, text),                                     │   │
│  │   insertChild(parentId, childId, index),                 │   │
│  │   removeChild(parentId, childId),                        │   │
│  │   setHandler(id, event, fn),                             │   │
│  │   flush()                                                │   │
│  │ }                                                        │   │
│  └──────────────────────────────────────────────────────────┘   │
└───┬─────────────────────────────────────────────────────────────┘
    │
    │ (Created by Bridge.cpp during installBindings)
    │
┌───▼─────────────────────────────────────────────────────────────┐
│  Hermes Host Functions (Native JSI)                             │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ __ui_createNode = createFromHostFunction(...)            │   │
│  │ __ui_setProp = createFromHostFunction(...)               │   │
│  │ __ui_setText = createFromHostFunction(...)               │   │
│  │ __ui_insertChild = createFromHostFunction(...)           │   │
│  │ __ui_removeChild = createFromHostFunction(...)           │   │
│  │ __ui_setHandler = createFromHostFunction(...)            │   │
│  │ __ui_flush = createFromHostFunction(...)                 │   │
│  └──────────────────────────────────────────────────────────┘   │
└───┬─────────────────────────────────────────────────────────────┘
    │
    │ (Direct C++ ↔ Kotlin via JNI)
    │
┌───▼─────────────────────────────────────────────────────────────┐
│  Kotlin UIShim Interface                                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ interface UIShim {                                       │   │
│  │   createNode(type: String): Int                          │   │
│  │   setProp(id: Int, name: String, value: String)         │   │
│  │   setText(id: Int, text: String)                         │   │
│  │   insertChild(parentId: Int, childId: Int, index: Int)   │   │
│  │   removeChild(parentId: Int, childId: Int)               │   │
│  │   setHandler(id: Int, event: String, handlerId: Long)    │   │
│  │   flush()                                                │   │
│  │   dequeueEventPayload(id: Int, event: String)            │   │
│  │ }                                                        │   │
│  └──────────────────────────────────────────────────────────┘   │
└───┬─────────────────────────────────────────────────────────────┘
    │
    │ (Implemented in RuneRuntime)
    │
┌───▼─────────────────────────────────────────────────────────────┐
│  RuneUIManager                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ override fun createNode(type: String): Int               │   │
│  │ override fun setProp(id, name, value)                    │   │
│  │ override fun setText(id, text)                           │   │
│  │ override fun insertChild(parent, child, index)           │   │
│  │ override fun removeChild(parent, child)                  │   │
│  │ override fun setHandler(id, event, handlerId)            │   │
│  │ override fun flush()                                     │   │
│  │ override fun dequeueEventPayload(id, event)              │   │
│  │                                                          │   │
│  │ + Node management                                        │   │
│  │ + View lifecycle                                         │   │
│  │ + Property application                                   │   │
│  │ + Event handler registration                             │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Rhino Architecture (Legacy - To Be Removed)

```
                    DEPRECATED - Do Not Use

┌─────────────────────────────────────────────────────────────────┐
│  JavaScript Global Scope (Rhino)                                │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ __ui = {                                                 │   │
│  │   createNode(type),                                      │   │
│  │   setText(id, text),                                     │   │
│  │   ... other methods                                      │   │
│  │ }                                                        │   │
│  └──────────────────────────────────────────────────────────┘   │
└───┬─────────────────────────────────────────────────────────────┘
    │ (Created by installRhinoBridge in RuneRuntime)
    │
┌───▼─────────────────────────────────────────────────────────────┐
│  Rhino Wrapper Functions (Kotlin)                               │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ adapter.setGlobalFunction("__ui_createNode") { ... }    │   │
│  │ adapter.setGlobalFunction("__ui_setText") { ... }        │   │
│  │ adapter.setGlobalFunction("__ui_insertChild") { ... }    │   │
│  │ adapter.setGlobalFunction("__ui_flush") { ... }          │   │
│  │                                                          │   │
│  │ + Uses reflection for type conversion                    │   │
│  │ + Manages Context/Scope                                  │   │
│  │ + Error handling via BaseFunction                        │   │
│  └──────────────────────────────────────────────────────────┘   │
└───┬─────────────────────────────────────────────────────────────┘
    │ (Kotlin λ callbacks)
    │
┌───▼─────────────────────────────────────────────────────────────┐
│  RuneUIManager                                                  │
│  (Same as Hermes path)                                          │
└─────────────────────────────────────────────────────────────────┘

❌ REMOVE:
   - RhinoAdapter.kt (entire file)
   - installRhinoGlobals() method
   - installRhinoBridge() method
   - Rhino-specific conditional logic
```

---

## 4. Event Handler Dispatch Flow

### Current (Hermes - Optimal)

```
User Action (Press Button)
    ↓
RuneButtonView.onPress()
    ↓
RunePressableView.Listener.onPress(nodeId)
    ↓
RuneUIManager.dispatchEvent(nodeId, "onPress")
    ↓
handlerMap.lookup(nodeId to "onPress")
    ↓
Found: HandlerRef.Hermes(handlerId=42)
    ↓
HermesAdapter.invokeHandler(handlerId=42, nodeId, event)
    ↓
Bridge.cpp: invokeHandler(42, nodeId, "onPress")
    ↓
Hermes Runtime calls JavaScript function
    ↓
Button press handler executes
    ↓
Framework may queue UI updates
```

### Legacy (Rhino - To Be Removed)

```
User Action (Press Button)
    ↓
RuneButtonView.onPress()
    ↓
RunePressableView.Listener.onPress(nodeId)
    ↓
RuneUIManager.dispatchEvent(nodeId, "onPress")
    ↓
handlerMap.lookup(nodeId to "onPress")
    ↓
Found: HandlerRef.Rhino(function)  ❌ DELETE THIS BRANCH
    ↓
RhinoAdapter.callFunction(function, args)
    ↓
Rhino Context calls JavaScript function
    ↓
Handler executes
    ↓
✅ Works, but less efficient than Hermes
```

---

## 5. State Management Across Layers

```
Node Lifecycle Tracking
┌────────────────────────────────────────────────────┐
│ RuneUIManager                                      │
├────────────────────────────────────────────────────┤
│                                                    │
│ nodes: SparseArray<Node>                          │
│ ├─ NodeId → Node object                           │
│ └─ Node contains:                                 │
│    ├─ id, type, view reference                    │
│    ├─ children list                               │
│    ├─ style properties                            │
│    ├─ text content                                │
│    └─ event handlers                              │
│                                                    │
│ parents: HashMap<NodeId, ParentNodeId?>           │
│ ├─ Used for tree traversal                        │
│ └─ Used for removal operations                    │
│                                                    │
│ handlers: Map<Pair<NodeId, Event>, HandlerRef>    │
│ ├─ Rhino path ❌ to remove:                        │
│ │  HandlerRef.Rhino(function)                     │
│ │  - Stores org.mozilla.javascript.Function       │
│ │  - Called via RhinoAdapter.callFunction()       │
│ │                                                  │
│ └─ Hermes path ✅ keep:                            │
│    HandlerRef.Hermes(handlerId: Long)             │
│    - Stores Hermes handler ID                     │
│    - Called via Bridge.cpp invokeHandler()        │
│                                                    │
│ pendingNativeOperations: List<NativeOperation>    │
│ ├─ SetProp, SetText, SetHandler queued            │
│ └─ Processed in batches (flush)                   │
│                                                    │
│ pendingViewOperations: List<ViewOperation>        │
│ ├─ Insert, Remove queued                          │
│ └─ Processed in batches (flush)                   │
│                                                    │
└────────────────────────────────────────────────────┘
```

---

## 6. Text Rendering Decision Tree

```
JavaScript: __ui.createNode("text")
    │
    ├─ Type = "text"?
    │  └─ YES
    │     │
    │     ├─ Is it Hermes runtime?
    │     │  ├─ YES → Create RuneTextInputView (optimized)
    │     │  └─ NO (legacy Rhino) → Create RuneTextInputView ❌
    │     │
    │     └─ Store View in Node
    │
    └─ Return nodeId

JavaScript: __ui.setText(nodeId, "Hello")
    │
    ├─ Is it Rhino? ❌
    │  └─ Special handling needed for Rhino context
    │
    └─ Queue SetText operation for flush

Flush:
    │
    ├─ Get Node from nodes[nodeId]
    │  │
    │  └─ Get View from Node
    │     │
    │     ├─ Is it RuneTextInputView?
    │     │  └─ YES → view.setText("Hello")
    │     │
    │     └─ Is it virtual text node?
    │        └─ YES → Propagate to parent
    │
    └─ Invalidate layout

Layout Engine:
    │
    └─ Measure text size
       └─ Apply to yoga node
```

---

## 7. Method Call Count Comparison

### Creating a Simple Button with Press Handler

#### Current (Hermes - Efficient)

```
JavaScript → Hermes → Bridge.cpp → Kotlin UIManager
            (1)         (2)           (3)

= 3 JNI boundaries
= ~0.5-1ms total latency
```

#### Legacy (Rhino - Less Efficient)

```
JavaScript → Rhino → Kotlin wrapper → UIManager
            (1)         (2)            (3)

+ Reflection type conversion
+ Context/Scope management
= 3-4 JNI boundaries + overhead
= ~1-2ms total latency
```

#### Event Dispatch

**Current (Hermes):**

```
Press → RuneUIManager.dispatchEvent()
     → handlerMap lookup
     → HermesAdapter.invokeHandler()
     → Bridge.cpp
     → Hermes Runtime
     → JavaScript handler
= 6 steps, ~0.3-0.5ms
```

**Legacy (Rhino):**

```
Press → RuneUIManager.dispatchEvent()
     → handlerMap lookup
     → RhinoAdapter.callFunction()  ❌
     → Rhino context evaluation
     → JavaScript handler
= 5 steps, ~0.5-1.0ms
+ Reflection overhead
```

---

## 8. Package Structure (Before & After)

### BEFORE (With Rhino)

```
com.rune.kit.runtime
├── RhinoAdapter.kt              ❌ ~4 KB
├── HermesAdapter.kt             ✅ ~8 KB
├── RuneRuntime.kt               ⚠️  ~28 KB (includes Rhino code)
├── JSBridge.kt                  ✅
├── RuneBridge.kt                ✅
├── JSRuntimeAdapter.kt          ✅
├── JsRuntimeException.kt         ✅
└── RuneModuleRegistry.kt         ✅

Total: ~100+ KB of Kotlin code
APK size: ~45 MB (with Rhino JAR ~1.5-2 MB)
```

### AFTER (Rhino Removed)

```
com.rune.kit.runtime
├── HermesAdapter.kt             ✅ ~8 KB
├── RuneRuntime.kt               ✅ ~20 KB (170 lines removed)
├── JSBridge.kt                  ✅
├── RuneBridge.kt                ✅
├── JSRuntimeAdapter.kt          ✅
├── JsRuntimeException.kt         ✅
└── RuneModuleRegistry.kt         ✅

Total: ~75 KB of Kotlin code
APK size: ~43-44 MB (Rhino JAR removed)
Savings: 1.5-2 MB + 8 KB Kotlin
```

---

## 9. Optimization Roadmap (Post-Cleanup)

```
Phase 1: Rhino Removal ✅
├─ Delete RhinoAdapter.kt
├─ Remove Rhino dependency
├─ Clean conditional logic
└─ 1.5-2 MB APK reduction

Phase 2: Method Consolidation (Weeks 2-3)
├─ Remove installRhinoGlobals()
├─ Remove installRhinoBridge()
├─ Simplify adapter initialization
└─ ~170 lines removed from RuneRuntime

Phase 3: Structural Refactoring (Weeks 3-4)
├─ Split RuneUIManager.kt
│  ├─ NodeManager.kt (node lifecycle)
│  ├─ StyleApplier.kt (property application)
│  ├─ EventHandler.kt (event dispatch)
│  ├─ TextManager.kt (text operations)
│  └─ LayoutManager.kt (layout integration)
├─ Extract color parsing utilities
├─ Reduce reflection usage
└─ 20-30% method complexity reduction

Phase 4: Performance Optimization (Weeks 4+)
├─ Cache handler lookups
├─ Batch event processing
├─ FlatList view recycling
├─ Lazy layout calculation
└─ Expected 10-20% FPS improvement
```

---

## 10. Quick Reference: Line Number Map

```
RuneRuntime.kt:

  26     │ import org.mozilla.javascript.Function ❌ REMOVE
         │
  78-80  │ when (RhinoAdapter) -> {...} ❌ REMOVE THIS BLOCK
         │
 141     │ is RhinoAdapter -> RhinoAdapter() ❌ REMOVE THIS BRANCH
         │
277-365  │ fun installRhinoGlobals(rhino) ❌ REMOVE METHOD (~89 lines)
         │
367-439  │ fun installRhinoBridge(rhino) ❌ REMOVE METHOD (~73 lines)
         │
471-487  │ handler is HandlerRef.Rhino && ... ❌ REMOVE THIS BLOCK
         │
 587     │ data class Rhino(val function) ❌ REMOVE VARIANT
         │
build.gradle.kts:

  81     │ org.mozilla:rhino:1.7.14 ❌ REMOVE
         │
RhinoAdapter.kt:

  1-110  │ Entire file ❌ DELETE
```

---

## Visual Execution Timeline

```
Frame N (60 FPS = 16.67ms per frame)

0ms  ├─ JavaScript code executes
     │  ├─ __ui.createNode("text") → queued
     │  ├─ __ui.setText(nodeId, "Hello") → queued
     │  └─ __ui.flush() → trigger operations
     │
2ms  ├─ RuneUIManager processes queue
     │  ├─ createNode: View object created
     │  └─ setText: Text content set
     │
4ms  ├─ Yoga layout engine calculates
     │  ├─ Measure: text size computed
     │  └─ Layout: positions calculated
     │
6ms  ├─ Android measure/layout pass
     │  ├─ onMeasure called
     │  └─ onLayout called
     │
8ms  ├─ Pending operations complete
     │
8-16.67ms
     │  (Idle, waiting for VSYNC)
     │
16.67ms ├─ VSYNC interrupt
        │  ├─ Android draw pass begins
        │  ├─ Canvas rendering
        │  └─ GPU composition
        │
18ms    ├─ GPU sends to display buffer
        │
19ms    ├─ Display ready
        │
20ms    └─ Display shows new frame

Frame N+1:
```

---

**Created:** October 22, 2025  
**Diagrams Version:** 1.0  
**Related Documents:** ROADMAP.md, TEXT_COMPONENT_FLOW.md, QUICK_REFERENCE.md
