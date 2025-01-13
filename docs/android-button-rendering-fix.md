# Android Button Initial Rendering Fix

## The Problem

A significant visual bug was identified in the native Android `Button` component where it would render incorrectly on the initial load of the application.

### Symptoms:
- **Clipped Appearance**: Buttons appeared vertically clipped, with their height being too short. The bottom of the button, including the rounded corners, was often not visible.
- **Misaligned Content**: The text and icons inside the button were misaligned, typically appearing too low within the visible button area.
- **Corrected by Interaction**: The layout of *all* buttons on the screen would correct itself as soon as any single button was tapped or pressed.

### Root Cause Analysis
Through extensive logging, we discovered the issue stemmed from a **"two-pass render"** sequence inherent in the cross-platform architecture:

1.  **First Pass (Unstyled)**: The native `RuneButtonView` was being created and added to the Android view hierarchy with default parameters (`padding=0`, `minHeight=0`, etc.). The Android layout system would perform a measure and layout pass with these incorrect, empty styles, resulting in the clipped appearance.
2.  **Second Pass (Styled)**: Immediately after the first pass, the style properties from the JavaScript layer (e.g., `padding`, `minHeight`, `backgroundColor`) would arrive and be applied to the native view. While a `requestLayout()` was called, it was not sufficient to force the Android layout system to correctly re-measure and re-draw the view in all circumstances, leaving the incorrectly rendered view on screen.

The core of the issue was a conflict in the measurement logic within `RuneButtonView.kt`. The view had a custom `onMeasure` override designed to enforce a minimum touch target size. This custom logic was interfering with the standard `FrameLayout` measurement process, preventing the `requestLayout()` call in the second pass from properly fixing the layout.

## The Solution

The fix was to remove the conflicting logic and entrust the button's measurement entirely to the standard, robust Android layout system.

The refactoring involved the following changes in `RuneButtonView.kt`:

1.  **Removed Custom `onMeasure`**: The entire `onMeasure` override was deleted. This allows the parent `FrameLayout`'s default measurement logic to execute, which correctly handles padding and minimum height/width properties.
2.  **Simplified Minimum Size Logic**: The `setMinimumTouchSize` method was simplified. The redundant internal properties it used (`minTouchWidthPx`, `minTouchHeightPx`) were removed, and the method now directly sets the standard `minimumWidth` and `minimumHeight` properties of the view.
3.  **Ensured Layout Request**: A `requestLayout()` call was added to the `init` block to ensure a layout pass is scheduled as soon as the view is initialized, complementing the existing `requestLayout()` call that occurs when styles are applied.

By removing the conflicting custom code, the standard Android layout process now works as expected. When the styles arrive in the second pass and `requestLayout()` is called, a proper re-measure and re-draw occurs, resulting in the button being rendered correctly from the very beginning.
