# ScrollView Rendering Diagnostics

This note documents the investigation that led to the current Android ScrollView fixes and some guidelines for spotting similar issues in the future.

## Symptom

Switching between the vertical and horizontal demos left the horizontal ScrollView blank. Debug logging showed that:

- The JS tree was still resolved – the host node swapped from 30 → 140 and the children array length was correct.
- `RuneScrollView` reported `contentView.childCount = 1`, yet `measuredWidth/Height` were `0` immediately after the swap.
- Yoga’s layout pass (via `RuneUIManager`) produced frames for the ScrollView (`node=140`) and its container (`node=141`), but the measured dimensions never updated. The native host therefore concluded that scrolling content size was `0`.

## Root Cause

Two things were at play:

1. **Out-of-sync measurement:** `RuneUIManager` relied on previously cached `measuredWidth/Height`. Once Yoga returned a new layout frame we never forced Android to re-measure the affected view tree, so the ScrollView thought it had no scrollable content.
2. **Width clamping in horizontal mode:** our renderer assigns a default `widthPercent = 100%` to every view. The ScrollView’s content container therefore matched the viewport width, preventing the horizontal example from expanding beyond the screen.

## Fixes

- After each Yoga pass we now call `view.measure(EXACTLY width, EXACTLY height)` whenever the measured size diverges from the Yoga frame. This keeps Android’s layout metrics in sync with the layout engine.
- `Style` now understands `width: "auto"` (and the corresponding Android bridge clears the default widthPercent). The ScrollView content container applies `width: "auto"` when the axis is horizontal so it can grow with its children.

## Debugging Checklist

When a view appears but its children disappear after a teardown:

1. **JS tree:** log or inspect the host node ref and child resolver. If the hierarchy looks correct, the issue is on the native side.
2. **Native hierarchy:** log the container’s `childCount`, `measuredWidth/Height`, and layout params right after host swaps. A `childCount > 0` with `measuredWidth/Height = 0` is a strong hint that Yoga and Android are out of sync.
3. **Yoga frames:** enable targeted logging in `RuneUIManager` around the layout loop to confirm what frame sizes Yoga produces. If frames look correct but Android sizes don’t, force a re-measure. If frames themselves are too small, revisit the Style props being applied (e.g. implicit widthPercent).

Long term, consider moving these diagnostics behind a feature flag so normal builds avoid the overhead while keeping the tools handy for regressions.
