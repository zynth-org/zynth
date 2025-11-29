# Rune UI

Theme system and higher-level UI primitives for Rune.

## Install

```bash
yarn add @rune/ui
```

## Usage

```tsx
import { UIThemeProvider } from "@rune/ui";

function App() {
  return (
    <UIThemeProvider>
      <Root />
    </UIThemeProvider>
  );
}
```

## Theme Overrides

```tsx
import { UIThemeProvider } from "@rune/ui";

const theme = {
  colors: {
    accent: "#0EA5E9",
    background: "#F8FAFC",
  },
  typography: {
    fontFamily: "System",
  },
};

function App() {
  return (
    <UIThemeProvider theme={theme} colorScheme="system">
      <Root />
    </UIThemeProvider>
  );
}
```

## Color Scheme Resolution

- Default: `system` (falls back to light if no system signal is available).
- Listens for native `RuneAppearance:change` when available.
- Uses `matchMedia("(prefers-color-scheme: dark)")` on web.

## Tokens

Theme tokens are plain objects and are kept serializable:

- `colors`
- `typography`
- `spacing`
- `radii`
- `sizes`

## Notes

- Tokens are designed to be platform-aware but override-friendly.
- DateTimePicker and other UI components will consume these tokens directly.
