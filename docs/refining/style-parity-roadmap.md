# Style Parity Roadmap

This document outlines the current status of style property support in Rune across Android and iOS, identifies gaps compared to standard CSS/React Native, and proposes a roadmap for achieving greater parity, specifically targeting CSS-like parsing for complex properties.

## 1. Current Support Status

Based on codebase analysis of `PropertyCategory.kt` (Android), `Style.kt` (Android), `HermesRuntimeHost.mm` (iOS), and `SNUIManager.m` (iOS).

### Flexbox & Layout (Yoga)

| Property | Android Support | iOS Support | Notes |
| :--- | :---: | :---: | :--- |
| `display` | ✅ | ✅ | `flex` \| `none` |
| `position` | ✅ | ✅ | `relative` \| `absolute` |
| `top`, `right`, `bottom`, `left` | ✅ | ✅ | |
| `width`, `height` | ✅ | ✅ | Auto, points, % |
| `minWidth`, `minHeight` | ✅ | ✅ | |
| `maxWidth`, `maxHeight` | ✅ | ✅ | |
| `aspectRatio` | ✅ | ✅ | |
| `overflow` | ✅ | ✅ | `visible` \| `hidden` \| `scroll` |
| `flex` | ✅ | ✅ | |
| `flexGrow` | ✅ | ✅ | |
| `flexShrink` | ✅ | ✅ | |
| `flexBasis` | ✅ | ✅ | |
| `flexDirection` | ✅ | ✅ | `row` \| `column` |
| `flexWrap` | ✅ | ✅ | `nowrap` \| `wrap` \| `wrap-reverse` |
| `justifyContent` | ✅ | ✅ | `flex-start`, `center`, `flex-end`, `space-between`, `space-around`, `space-evenly` (iOS only?) |
| `alignItems` | ✅ | ✅ | `flex-start`, `center`, `flex-end`, `stretch`, `baseline` |
| `alignSelf` | ✅ | ✅ | |
| `alignContent` | ✅ | ✅ | |
| `gap`, `rowGap`, `columnGap` | ✅ | ✅ | |
| `padding`, `paddingVertical`, `paddingHorizontal` | ✅ | ✅ | + Top, Right, Bottom, Left |
| `margin`, `marginVertical`, `marginHorizontal` | ✅ | ✅ | + Top, Right, Bottom, Left |
| `zIndex` | ✅ | ✅ | Mapped to `translationZ` (Android) / `zPosition` (iOS) |
| `direction` | ❌ | ❌ | RTL support pending |

### Visual & Box Model

| Property | Android Support | iOS Support | Notes |
| :--- | :---: | :---: | :--- |
| `backgroundColor` | ✅ | ✅ | Hex, Named, RGB/A, HSL/A, HWB |
| `opacity` | ✅ | ✅ | |
| `borderRadius` | ✅ | ✅ | Uniform radius only. Corner-specific pending. |
| `borderWidth` | ✅ | ✅ | Uniform width only. Side-specific pending. |
| `borderColor` | ✅ | ✅ | Uniform color only. Side-specific pending. |
| `borderStyle` | ✅ | ✅ | `solid` \| `dotted` \| `dashed` |
| `boxShadow` / `elevation` | ❌ | ❌ | **Major Gap** |
| `transform` | ❌ | ❌ | **Major Gap** |

### Text & Fonts

| Property | Android Support | iOS Support | Notes |
| :--- | :---: | :---: | :--- |
| `color` | ✅ | ✅ | |
| `fontSize` | ✅ | ✅ | |
| `fontWeight` | ✅ | ✅ | Numeric & Keywords |
| `fontFamily` | ❌ | ❌ | Pending |
| `fontStyle` | ❌ | ❌ | `italic` pending |
| `textAlign` | ❌ | ❌ | Pending |
| `lineHeight` | ❌ | ❌ | Pending |
| `textDecoration...` | ❌ | ❌ | Pending |
| `letterSpacing` | ❌ | ❌ | Pending |

## 2. Gap Analysis & Implementation Plan

### Phase 1: Box Model Refinement (High Priority)
*   **Goal:** Support individual border sides and corner radii.
*   **Missing Props:**
    *   `borderTopWidth`, `borderRightWidth`, `borderBottomWidth`, `borderLeftWidth`
    *   `borderTopColor`, `borderRightColor`, `borderBottomColor`, `borderLeftColor`
    *   `borderTopLeftRadius`, `borderTopRightRadius`, `borderBottomRightRadius`, `borderBottomLeftRadius`
*   **Strategy:**
    *   **Android:** Update `RoundedOutline` or custom `Drawable` logic in `RunePropApplier` to handle path clipping for non-uniform borders.
    *   **iOS:** Update `SNApplyBorderStyleToView` to use `CAShapeLayer` with path manipulation for individual borders/corners.

### Phase 2: Transformations (High Priority)
*   **Goal:** CSS-compatible transform syntax.
*   **Input:** `transform: "translate(10px, 20px) rotate(45deg) scale(1.5)"` OR Array format (RN style).
*   **Missing Props:** `transform`, `transformOrigin`.
*   **Strategy:**
    *   **Parser:** Implement `RuneTransformParser` on both platforms to parse string syntax into matrix operations.
    *   **Android:** Apply to `View.setTranslationX/Y`, `setRotation`, `setScaleX/Y`.
    *   **iOS:** Apply to `CALayer.transform` (CATransform3D).

### Phase 3: Shadows (Medium Priority)
*   **Goal:** CSS `box-shadow` support.
*   **Input:** `box-shadow: "10px 5px 5px red"`
*   **Missing Props:** `boxShadow`, `shadowColor`, `shadowOffset`, `shadowOpacity`, `shadowRadius`, `elevation`.
*   **Strategy:**
    *   **Android:**
        *   Simple `elevation` (easy mapping).
        *   Complex shadows: Requires custom `OutlineProvider` or `Paint` shadows (harder on Android < 9, improved in newer APIs).
    *   **iOS:** Direct mapping to `CALayer` shadow properties (`shadowColor`, `shadowOffset`, `shadowOpacity`, `shadowRadius`).

### Phase 4: Background Gradients (Medium Priority)
*   **Goal:** Support gradients directly in `background` / `backgroundImage` prop without a separate component.
*   **Input:** `background: "linear-gradient(45deg, red, blue)"`
*   **Strategy:**
    *   **Parser:** Implement `RuneGradientParser`.
    *   **Android:** Render via `GradientDrawable` in `RunePropApplier`.
    *   **iOS:** Render via `CAGradientLayer` inserted as sublayer.

### Phase 5: Typography (Low Priority - Continuous)
*   Add `fontFamily`, `lineHeight`, `textAlign`, etc., as needed.

## 3. Next Steps

1.  **Standardize Parsers:** We have `RuneColorParser`. We need `RuneTransformParser`, `RuneShadowParser`, and `RuneGradientParser`.
2.  **Update `Style` Objects:** Add new fields to `Style.kt` and `HostTypes.ts`.
3.  **Implement Native Handlers:** Expand `RunePropApplier` (Android) and `SNUIManager` (iOS) to handle the new parsing results.
