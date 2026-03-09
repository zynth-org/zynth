# Style API (`@zynth/core`)

Official style authoring system for Zynth runtime.

`Style` is designed for:

- predictable authoring for developers and AI agents
- key-level reactive updates (not full object replacement)
- compatibility with plain style objects and arrays
- native-friendly batching and patch semantics

## Basic

### Import

```ts
import { Style } from "@zynth/core";
```

### 1) Static styles

Use `Style.create` for stable static style refs.

```ts
const styles = Style.create({
  container: {
    flex: 1,
    backgroundColor: "#0b1220",
    padding: 16,
  },
  title: {
    color: "#e2e8f0",
    fontSize: 18,
    fontWeight: "700",
  },
});
```

### 2) Reactive keys

Use `Style.bind` for dynamic values. Each key is tracked independently.

```ts
const cardStyle = Style.bind(styles.container, {
  borderRadius: () => (compactMode() ? 10 : 16),
  backgroundColor: () => (active() ? "#1d4ed8" : "#0b1220"),
});
```

### 3) Composition

Use `Style.compose` for layered style refs.

```ts
const surfaceStyle = Style.compose(
  styles.container,
  { borderWidth: 1, borderColor: "#334155" },
  props.style
);
```

### In components

`View` and `Text` accept:

- plain style objects
- arrays
- `Style` refs (`create` / `bind` / `compose`)

```tsx
<View style={cardStyle}>
  <Text style={styles.title}>Hello</Text>
</View>
```

## Advanced

### Why this exists

Inline reactive objects are easy to write but often create coarse update paths.
`Style.bind` gives per-key reactivity so a single key change emits only that key.

### Patch model

Runtime resolves style layers and produces key-level patches:

- `changed`: keys with new values
- `removed`: keys that no longer apply

This avoids full-style churn on every signal update.

### Removal semantics

To remove a dynamic key, return `null` or `undefined`:

```ts
const shadowStyle = Style.bind(styles.container, {
  boxShadow: () => (elevated() ? "0px 8px 20px rgba(0,0,0,0.25)" : null),
});
```

### Structural toggle vs style toggle

For transitions that must feel atomic, prefer style-driven visibility over structural mount/unmount.

```ts
const snippetStyle = Style.bind(baseSnippet, {
  display: () => (compactMode() ? "none" : "flex"),
});
```

This keeps visibility changes in the same style patch pipeline.

### Dev warnings

In development, `Style` warns about unstable patterns:

- `Style.create` in tracking scopes
- `Style.bind` in tracking scopes
- unsupported dynamic value shapes

Hoist static declarations and keep refs stable.

### Compatibility

Existing plain object styles remain supported. You can migrate incrementally:

1. Move stable styles to `Style.create`
2. Move hot reactive keys to `Style.bind`
3. Use `Style.compose` to combine base, conditional, and external layers

## API reference

### `Style.create(record)`

Creates static style refs from a record.

```ts
const styles = Style.create({
  root: { flex: 1 },
  label: { fontSize: 14 },
});
```

### `Style.bind(baseOrDynamic, dynamic?)`

Creates a bound style ref.

Overloads:

- `Style.bind(dynamic)`
- `Style.bind(base, dynamic)`

Dynamic values may be:

- literal style value
- accessor `() => value`
- `null` / `undefined` for removal

```ts
const bound = Style.bind(styles.root, {
  width: () => (dense() ? 140 : 220),
});
```

### `Style.compose(...layers)`

Composes style layers left-to-right. Later layers override earlier ones.

```ts
const composed = Style.compose(styles.root, props.style, {
  borderRadius: 12,
});
```

### Types

Core exported style types:

- `StyleRef`
- `StaticStyleRef`
- `BoundStyleRef`
- `ComposedStyleRef`
- `StyleProp`

## Performance guidance

- Prefer `Style.create` for static blocks.
- Prefer `Style.bind` for hot, frequently-changing keys.
- Avoid recreating style refs inside tracking scopes.
- Use structural conditionals for real mount/unmount semantics, and style toggles for atomic visual transitions.

## Notes

- `StyleGraph` remains as compatibility alias in core exports.
- New usage should use `Style` as the public name.
