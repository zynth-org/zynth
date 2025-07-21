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
| `transform` | ✅ | ✅ | CSS string + RN array. `transformOrigin` follow-up. |

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

### Phase 2: Transformations (Completed)
*   **Goal:** CSS-compatible transform syntax.
*   **Delivered:** `transform` accepts CSS string and RN array formats and applies translate/rotate/scale to Yoga + native views. `transformOrigin` introduced as a follow-up to position transforms correctly.
*   **Notes:** Keep parser shared across platforms to mirror the Color pipeline and keep future 3D extensions contained.

### Phase 3: Shadows (Medium Priority, In Progress)
*   **Goal:** Redundant shadow support: React Native shadow props + CSS `box-shadow` parsing for parity on both platforms.
*   **Inputs:**
    *   RN-style props: `shadowColor`, `shadowOffset`, `shadowOpacity`, `shadowRadius`, `elevation`.
    *   CSS string: `box-shadow: "10px 5px 5px red"` (support multiple shadows and `inset` where possible).
*   **Parser:**
    *   Add `RuneShadowParser` (standalone module, imported by Android/iOS bridges) to normalize CSS strings into a common struct: color, x/y offset, blur, spread, inset flag.
    *   Allow RN props to bypass parsing but reuse the same normalized shadow model internally for consistency.
*   **Strategy:**
    *   **Android:**
        *   Map `elevation` directly for the RN-compatible path.
        *   For parsed `boxShadow`, render via `Paint.setShadowLayer` for API 28+; fall back to elevation-only or clipped drawable on lower APIs.
        *   Use `OutlineProvider`/custom `Drawable` to honor spread/inset where available; degrade gracefully when the platform cannot represent it.
    *   **iOS:**
        *   Map RN props to `CALayer.shadowColor`, `shadowOffset`, `shadowOpacity`, `shadowRadius`, with `shadowPath` derived from layout/border radius.
        *   Translate parsed CSS shadows into the same layer properties; for multiple shadows, consider stacked backing layers to emulate CSS rendering order.

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

1.  **Shadow Parser:** Ship `RuneShadowParser` as a shared module (mirroring Color) and accept both CSS `box-shadow` strings and RN shadow props to produce one normalized model.
2.  **Style Shapes:** Add `boxShadow` + RN shadow fields to `Style.kt` and `HostTypes.ts`, including spread/inset markers for downstream rendering.
3.  **Native Handling:** Wire `RunePropApplier` and `SNUIManager` to consume the normalized shadow model, with platform-specific fallbacks for multiple shadows and pre-28 Android devices.
4.  **Dev Harness Coverage:** Add a few component stories in `apps/components` to exercise RN props vs. CSS `box-shadow` strings side-by-side.
