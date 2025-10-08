# Rune Agent bootstrap prompt

## Purpose ✅

This prompt helps an AI agent understand the Rune monorepo and how to develop components and features using the Rune framework. Keep responses concise, reference files precisely, and prefer minimal, testable changes (small commits, clear PR descriptions).

---

## Quick repo overview 🔧

- Monorepo with TypeScript workspaces (yarn). Primary runtime packages live under `packages/` and example app under `apps/components`.
- UI layer uses SolidJS (JSX) and a Yoga-based native renderer.
- Key packages available (non-exhaustive):
  - `@rune/components` — cross-platform primitives (View, Text, Button, Image, ScrollView, TextField, etc.)
  - `@rune/memory-router` — navigation primitives
  - `@rune/components` (examples live in `apps/components/src/components/`)
  - `@rune/keyboard`, `@rune/safe-area`, `@rune/icons`, `@rune/bottom-sheet`, `@rune/apis`

---

## Development conventions ✳️

- Language: **TypeScript (strict)**. Use ESM imports and prefer small focused files.
- UI: **SolidJS** — use signals, Show, and direct JSX return values.
- Styling: Use Yoga-like style props on Rune primitives, e.g. `style={{ flexDirection: 'row', gap: 8 }}`. Styles are plain objects (no CSS files).

---

## How to create a small component (example) 💡

Example: a tiny card component using `@rune/components` primitives.

```tsx
import { View, Text, Button } from "@rune/components";
import type { JSX } from "solid-js";

export interface SimpleCardProps {
  title: string;
  subtitle?: string;
  onPress?: () => void;
}

export default function SimpleCard(props: SimpleCardProps): JSX.Element {
  return (
    <View
      style={{ padding: 12, borderRadius: 8, backgroundColor: "#fff", gap: 8 }}
    >
      <Text style={{ fontSize: 16, fontWeight: "700" }}>{props.title}</Text>
      {props.subtitle && (
        <Text style={{ color: "#666", fontSize: 12 }}>{props.subtitle}</Text>
      )}
      <Button onPress={props.onPress}>
        <Text style={{ color: "white", fontWeight: "600" }}>Action</Text>
      </Button>
    </View>
  );
}
```

You are an agent, explore the project and edit the needed files to complete this task
