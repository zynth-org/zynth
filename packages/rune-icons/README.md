# @rune/icons

Icon font pack generated from [`solid-icons`](https://www.npmjs.com/package/solid-icons), bundled for Rune native apps.

## How generation works

- Run `yarn workspace @rune/icons generate` (or `node --experimental-strip-types scripts/generate.ts`).
- The script reads every `solid-icons/<pack>/index.cjs`, stubs `IconTemplate`, and captures each icon’s SVG definition.
- Icons with opacity/two-tone markers are **skipped** (fonts can’t represent them cleanly).
- Remaining icons are written as Solid components in `src/<pack>.tsx`, each using `createIcon` with a glyph + font family.
- `svgtofont` builds a font per pack. Outputs are pruned to only:
  - `dist/fonts/<pack>/<FontName>.ttf`
  - `dist/fonts/<pack>/glyph-map.json`
  - `dist/fonts/<pack>/info.json`
- TTF files are copied to `ios/Fonts` and `android/src/main/assets/fonts`.
- An index export is regenerated at `src/index.ts`. Metadata is stored at `dist/icons-meta/solid-icons.json`.

## What ships

- Runtime components import from `@rune/icons/<pack>` and render a `<Text>` with the pack font.
- Fonts are **per pack**, but tree-shaking does **not** remove unused TTFs once copied to the native assets folders. To slim size, limit which packs you generate or delete unused packs before packaging.
- JS exports are tree-shakeable; the fonts themselves are not automatically pruned by bundlers.

## Usage

```tsx
import { AiFillAlipayCircle } from "@rune/icons/ai";

<AiFillAlipayCircle style={{ fontSize: 24, color: "#222" }} />;
```

After generation, ensure the native projects pick up the copied fonts (already placed under `ios/Fonts` and `android/src/main/assets/fonts`).
