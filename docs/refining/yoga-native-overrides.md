# Yoga Native Overrides

Add native Yoga property override support to allow views to modify their layout constraints directly without JS involvement.

## Problem

High-frequency layout updates (keyboard animations, gestures) suffer from performance issues due to the JS bridge round-trip:

```
Native Event → JS eval → Signal update → Style change → Yoga recalc → Native update
```

Each keyboard animation frame (~60fps) triggers this full cycle, causing visible FPS drops on Android.

## Solution

Allow native views to directly modify their Yoga node properties, bypassing JS entirely:

```
Native Event → Yoga node override → Layout pass → Done
```

## API Design

### Option 1: Yoga Style Override Methods (Recommended)

Add methods to the UI manager that let native code override specific Yoga properties for a node.

#### iOS

```objc
// SNUIManager+YogaOverrides.h
@interface SNUIManager (YogaOverrides)

/// Set a Yoga property override for a node. Triggers layout.
- (void)setYogaOverride:(NSNumber *)nodeId
               property:(NSString *)property  // "paddingBottom", "marginBottom", "height", etc.
                  value:(CGFloat)value;

/// Clear a specific Yoga override, reverting to JS-defined value.
- (void)clearYogaOverride:(NSNumber *)nodeId
                 property:(NSString *)property;

/// Clear all overrides for a node.
- (void)clearAllYogaOverrides:(NSNumber *)nodeId;

@end
```

Usage in `RuneKeyboardAvoidingView`:

```objc
// During keyboard animation - no JS involved
- (void)handleKeyboardHeight:(CGFloat)height {
    SNNode *node = [self.manager nodeForView:self];
    if (node) {
        [self.manager setYogaOverride:@(node.nid)
                             property:@"paddingBottom"
                                value:height];
    }
}
```

#### Android

```kotlin
// RuneUIManager extension
interface YogaOverrides {
    fun setYogaOverride(nodeId: Int, property: String, value: Float)
    fun clearYogaOverride(nodeId: Int, property: String)
    fun clearAllYogaOverrides(nodeId: Int)
}
```

Usage in `RuneKeyboardAvoidingView`:

```kotlin
// During keyboard animation - no JS involved
override fun onProgress(insets: WindowInsetsCompat, ...): WindowInsetsCompat {
    val keyboardHeight = insets.getInsets(Type.ime()).bottom / density
    uiManager.setYogaOverride(nodeId, "paddingBottom", keyboardHeight)
    return insets
}
```

## Implementation Plan

### Phase 1: Core Infrastructure

1. **Add override storage to Node**

   - iOS: Add `NSMutableDictionary *yogaOverrides` to `SNNode`
   - Android: Add `MutableMap<String, Float> yogaOverrides` to `Node`

2. **Implement override methods in UIManager**

   - `setYogaOverride`: Store value, apply to Yoga node, trigger layout
   - `clearYogaOverride`: Remove stored value, reapply original JS style
   - `clearAllYogaOverrides`: Clear all overrides for node

3. **Modify style application flow**
   - When applying styles, check for overrides first
   - Overrides take precedence over JS-defined values

### Phase 2: Supported Properties

Start with layout-affecting properties:

| Property        | Yoga Function             | Use Case                 |
| --------------- | ------------------------- | ------------------------ |
| `paddingTop`    | `YGNodeStyleSetPadding`   | Keyboard avoiding        |
| `paddingBottom` | `YGNodeStyleSetPadding`   | Keyboard avoiding        |
| `marginTop`     | `YGNodeStyleSetMargin`    | Animations               |
| `marginBottom`  | `YGNodeStyleSetMargin`    | Keyboard height behavior |
| `height`        | `YGNodeStyleSetHeight`    | Dynamic sizing           |
| `minHeight`     | `YGNodeStyleSetMinHeight` | Constraints              |
| `maxHeight`     | `YGNodeStyleSetMaxHeight` | Constraints              |

### Phase 3: View Protocol

Create a protocol for views that need Yoga access:

```swift
// iOS
@objc protocol YogaAwareView {
    var yogaNodeId: Int { get }
    weak var uiManager: SNUIManager? { get }
}

extension YogaAwareView {
    func setYogaOverride(_ property: String, value: CGFloat) {
        uiManager?.setYogaOverride(NSNumber(value: yogaNodeId),
                                    property: property,
                                    value: value)
    }
}
```

```kotlin
// Android
interface YogaAwareView {
    val yogaNodeId: Int
    val uiManager: RuneUIManager?

    fun setYogaOverride(property: String, value: Float) {
        uiManager?.setYogaOverride(yogaNodeId, property, value)
    }
}
```

### Phase 4: Update KeyboardAvoidingView

Refactor to use native Yoga overrides:

```swift
// iOS - RuneKeyboardAvoidingView.swift
class RuneKeyboardAvoidingView: UIView, YogaAwareView {
    private func handleKeyboardWillShow(_ notification: Notification) {
        guard let height = extractKeyboardHeight(notification) else { return }

        switch behavior {
        case .padding:
            setYogaOverride("paddingBottom", value: height + offset)
        case .height:
            setYogaOverride("marginBottom", value: height + offset)
        case .position:
            // Use transform for position (doesn't affect Yoga)
            transform = CGAffineTransform(translationX: 0, y: -height - offset)
        }
    }

    private func handleKeyboardWillHide(_ notification: Notification) {
        clearYogaOverride("paddingBottom")
        clearYogaOverride("marginBottom")
        transform = .identity
    }
}
```

## Performance Comparison

| Approach              | Updates/sec | Latency | FPS Impact       |
| --------------------- | ----------- | ------- | ---------------- |
| Current JS bridge     | ~30-60      | 2-5ms   | Noticeable drops |
| Native Yoga overrides | ~60+        | <0.5ms  | Smooth 60fps     |

## Future Use Cases

This infrastructure enables:

1. **Gesture-driven layouts**: Pan gestures directly modifying view heights
2. **Spring animations**: Native spring physics affecting layout
3. **Reanimated-style worklets**: Layout properties driven by native animation values
4. **Keyboard interactive dismiss**: Smooth tracking as user drags keyboard

## Testing Checklist

- [ ] Override applies correctly and triggers layout
- [ ] Override persists across JS style updates
- [ ] Clear override reverts to JS value
- [ ] Multiple overrides on same node work
- [ ] Override works during animations (60fps)
- [ ] Memory: overrides cleaned up on node removal
- [ ] Thread safety: overrides from animation callbacks

## Files to Modify

### iOS

- `packages/rune-ios/ios/RuneKit/src/SNNode.h` - Add overrides storage
- `packages/rune-ios/ios/RuneKit/src/SNUIManager.m` - Add override methods
- `packages/rune-ios/ios/RuneKit/src/SNUIManager+Style.m` - Check overrides in style application
- `packages/rune-keyboard/ios/RuneKeyboardAvoidingView.swift` - Use overrides

### Android

- `packages/rune-android/.../RuneUIManager.kt` - Add override methods
- `packages/rune-android/.../Node.kt` - Add overrides storage
- `packages/rune-android/.../RunePropApplier.kt` - Check overrides
- `packages/rune-keyboard/android/.../RuneKeyboardAvoidingView.kt` - Use overrides
