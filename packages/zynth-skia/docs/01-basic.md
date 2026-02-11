# @zynth/skia - Basic

## Install

```bash
yarn add @zynth/skia
```

Regenerate native projects after adding the package.

## Basic usage

```tsx
import { Canvas, Circle, Group, Path, Rect } from "@zynth/skia";

export function BasicSkiaScene() {
  return (
    <Canvas clearColor="#0B1220" style={{ width: 320, height: 180 }}>
      <Group>
        <Rect
          x={18}
          y={18}
          width={284}
          height={144}
          color="#1E293B"
          style="stroke"
          strokeWidth={2}
        />
        <Path
          path="M 0 90 L 320 90 M 160 0 L 160 180"
          color="#334155"
          style="stroke"
          strokeWidth={2}
        />
        <Circle cx={160} cy={90} r={26} color="#38BDF8" />
      </Group>
    </Canvas>
  );
}
```

## Concept model

- `Canvas` compiles declarative nodes into packed native draw commands.
- `Paint` scopes style/shader defaults to child nodes.
- `Group` composes transforms (`translate`, `scale`, `rotate`, origin).

## When to use declarative vs imperative

- Use declarative API for Solid-native composition and reuse.
- Use imperative API when you need explicit command scheduling or external render loops.
