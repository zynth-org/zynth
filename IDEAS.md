# Rune Feature Ideas & Implementation Sketches

This document contains ideas for future features and technical sketches for their implementation. These are features that are not on the immediate roadmap but are good to keep in mind for enhancing the framework's capabilities.

---

## Advanced Interaction Control: `pointerEvents`

The `pointerEvents` prop is crucial for creating complex UI layouts, such as non-blocking overlays. While the `'auto'` and `'none'` values are implemented, the `'box-none'` and `'box-only'` values require more advanced native implementation.

### Desired Behavior

-   **`box-only`**: The view itself can receive touches, but its children cannot.
-   **`box-none`**: The view itself cannot receive touches, but its children can.

### iOS Implementation Sketch

The implementation on iOS requires creating a custom `UIView` subclass and overriding the `hitTest:withEvent:` method. This method determines which view should receive a touch event.

1.  **Create `RunePointerEventsView.m`**: A subclass of `UIView`.
2.  **Add `pointerEvents` Property**: This view will have a property to hold the desired `pointerEvents` behavior.
3.  **Override `hitTest:withEvent:`**:
    -   If `pointerEvents` is `'box-only'`, the method should check if the touch is within its own bounds. If it is, it returns `self` and does not check its children.
    -   If `pointerEvents` is `'box-none'`, the method first checks if the touch hits any of its children. If it does, it returns that child. If no children are hit, it returns `nil`, even if the touch is within its own bounds.
4.  **Update `SNUIManager.m`**: Modify `createNode:` to instantiate `RunePointerEventsView` instead of a generic `UIView` for elements that might use this prop.

### Android Implementation Sketch

The implementation on Android requires creating a custom `ViewGroup` subclass (e.g., extending `FrameLayout`) and overriding its touch interception methods.

1.  **Create `RunePointerEventsViewGroup.kt`**: A subclass of `FrameLayout`.
2.  **Add `pointerEvents` Property**: This view will have a property to hold the desired `pointerEvents` behavior.
3.  **Override `onInterceptTouchEvent(MotionEvent)`**: This method decides if the `ViewGroup` should "steal" a touch event from its children.
    -   If `pointerEvents` is `'box-only'`, this method should always return `true`, indicating that it wants to handle all touch events itself and not pass them to children.
    -   If `pointerEvents` is `'box-none'`, this method should always return `false`, indicating that it never wants to handle touch events, allowing them to always be passed to its children.
4.  **Update `RuneUIManager.kt`**: Modify `createNode` to instantiate `RunePointerEventsViewGroup` instead of a generic `FrameLayout`.
