# Native Button Refactor Proposal (iOS)

## Objective
Refactor the existing `Button` primitive on iOS to use the native `UIButton` class (specifically utilizing modern `UIButtonConfiguration` APIs introduced in iOS 15) instead of a custom `UIView` with simulated touch handling.

## Motivation
1.  **Native Look & Feel:** Users expect buttons to behave exactly like system buttons (animations, haptics, highlighting, pointer interactions on iPad).
2.  **Maintainability:** Offload interaction state management (pressed, focused, disabled) to the OS.
3.  **Accessibility:** `UIButton` comes with built-in accessibility traits and behaviors that are difficult to replicate perfectly in a custom view.

## Proposed API Changes

We will introduce new properties to map directly to `UIButtonConfiguration` styles, while maintaining support for Yoga layout where possible.

### New Props

| Prop Name | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `variant` | `'plain' \| 'filled' \| 'gray' \| 'tinted'` | `'plain'` | Maps to `UIButton.Configuration` styles. |
| `role` | `'normal' \| 'destructive' \| 'cancel'` | `'normal'` | Affects color semantics (e.g., destructive makes it red). |
| `size` | `'mini' \| 'small' \| 'medium' \| 'large'` | `'medium'` | Maps to `UIButton.Configuration.Size`. |
| `title` | `string` | `undefined` | **(Optional)** Use native text rendering. If provided, this is rendered by the OS. |
| `image` | `ImageSource` | `undefined` | **(Optional)** Native icon support. |
| `baseColor` | `string` (Color) | System Blue | Sets the `tintColor` or background fill depending on the variant. |

### Usage Examples

#### 1. The "System" Button (Pure Native)
Best for standard UI elements (Navbar buttons, dialog actions).
```tsx
<Button 
  variant="filled" 
  title="Submit" 
  role="normal" 
  onPress={handleSubmit} 
/>
```

#### 2. The "Container" Button (Composability)
Retains the ability to nest arbitrary children (like our `Text` or `Image` components).
```tsx
<Button variant="tinted" onPress={handlePress}>
  <Text style={{ color: 'blue', fontWeight: 'bold' }}>
    Custom Content
  </Text>
</Button>
```

## Implementation Strategy (iOS)

### 1. Inheritance Change
Change `RuneButtonView` to inherit from `UIButton` instead of `RuneHitTestingView` (UIView).

```objective-c
// RuneButtonView.h
@interface RuneButtonView : UIButton
```

### 2. Configuration Management
We will use `UIButtonConfiguration` (iOS 15+) to handle styling.

*   **If children are present:** We use a configuration (likely `plain` or `filled`) but clear the `title` and `image` from the configuration. We add the children as subviews to the `UIButton`.
    *   *Challenge:* `UIButton` manages its own layout. We must ensure Yoga (our layout engine) can still dictate the frame of the button, and that the children are positioned correctly within that frame.
    *   *Solution:* `RuneButtonView` will still respect `layoutSubviews` triggered by the shadow tree, but we must ensure the `UIButtonConfiguration` doesn't override our custom content layout.

*   **If `title` prop is present:** We set `config.title = prop`. This allows `UIButton` to handle the text rendering, font scaling, and positioning automatically.

### 3. State Management
Remove manual touch tracking (`touchesBegan`, etc.).
*   **Events:** Map `UIControlEventTouchUpInside` to the `onPress` callback.
*   **Highlighting:** `UIButton` handles this automatically based on the `variant`.

### 4. Layout Constraints (Yoga vs Native)
*   **Sizing:** Native buttons have an "intrinsic content size" based on their text/image.
*   **Yoga:** Typically forces a size.
*   **Reconciliation:** If the user sets `width: auto` (or undefined), we should let the Button measure itself using `sizeThatFits`. If the user sets explicit dimensions, Yoga overrides the native size.

## Migration Concerns
*   **Existing Styling:** Current usage might rely on `backgroundColor` or `opacity` being set manually via style.
    *   *Refactor:* `backgroundColor` on a `UIButton` with a `filled` configuration might need to be applied to `config.baseBackgroundColor` instead of `layer.backgroundColor`.
*   **Borders:** `UIButtonConfiguration` handles corner radius and borders differently than standard generic Views. We may need to map `borderRadius` props to the configuration's `background.cornerRadius`.

## Next Steps
1.  Confirm this API aligns with the project goals.
2.  Begin implementation in `packages/rune-components/ios/src/Button/RuneButtonView.m`.
