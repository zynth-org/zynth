# Rune Android — Loaded Startup Component Guidelines

### Purpose

A **Loaded Startup Component** (e.g. `TextInput`, `Map`, `Video`, `WebView`) is any native view that does heavy work during its first mount.
All such components must **render deterministically**, **never flash or collapse**, and **align to vsync** on reveal.

---

## Core Rules

### 1. Deterministic First Measure

- Implement `ensureBaselineConstraints()` → sets a safe `minHeight` / intrinsic size **before first layout**.
- Prevents 0×0 measures or one-frame holes during mount.

### 2. Vsync-Aligned Reveal

- Use `runAfterReveal(action)` + `hasCompletedFirstReveal` flags.
- Mark reveal in `onLayout()` when bounds are non-zero, and flush queued actions next vsync (`postOnAnimation`).
- Ensures first draw = geometry only, side-effects = next frame.

### 3. Side-Effect Deferral

- **Focus, selection, IME, playback, JS bridges** must run via `runAfterReveal()`.
- Avoid work that could block the first paint.

### 4. Stable Visibility & Sticky Frames

- Never use `GONE` on first layout; use `INVISIBLE` until sized.
- Renderer may reuse previous non-zero frame once (“sticky frame”) to avoid visible holes, then re-layout next vsync.

### 5. Ordered Prop Application

- Renderer must apply props in this order:
  **A. Measure props** → `multiline`, `padding`, `background`, etc.
  **B. Content props** → text, URLs, media sources.
  **C. Event props** → handlers, focus triggers.
- Measure props always applied **before layout**.

### 6. Vsync Flush Scheduling

- All flushes go through `FrameScheduler.scheduleFlush()`.
- New or sticky components use `FlushPriority.HIGH` so they land on the imminent vsync.
- No fixed-delay commits.

### 7. Background & Padding Before Draw

- Apply visual props (background, padding, border) before layout.
- Prevent first-frame “white flash” from themed defaults.

---

## Common Methods to Implement

```kotlin
fun ensureBaselineConstraints(): Boolean
fun runAfterReveal(action: () -> Unit)
fun markRevealIfSized() // from onLayout()
fun resetFirstFrameState()
```

---

## Renderer Integration

- `RuneUIManager.performFlush()` → sticky frame logic, INVISIBLE/VISIBLE policy.
- `FrameScheduler.scheduleFlush()` → vsync commits, HIGH priority for mounts.
- `processPendingNativeOperations()` → ensure measure props applied first.
- `engine.markDirty(nodeId)` when `ensureBaselineConstraints()` changes size.

---

## QA Checklist

✅ No 1-frame gaps or reflows
✅ No white flash or theme default visible
✅ Focus/IME/playback occur one vsync after reveal
✅ Frame commits are vsync-aligned
✅ Sticky reuse never exceeds one frame
