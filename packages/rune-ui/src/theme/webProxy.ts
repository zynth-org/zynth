import { uiThemeLight } from "./defaults";
import type { UITheme } from "./types";

// We use the light theme structure as a base for spacing/sizes/etc.
// The colors will be replaced by CSS variables.
const webColors = {
  background: "var(--rune-color-background)",
  surface: "var(--rune-color-surface)",
  surfaceAlt: "var(--rune-color-surface-alt)",
  card: "var(--rune-color-card)",
  text: "var(--rune-color-text)",
  textMuted: "var(--rune-color-text-muted)",
  textSubtle: "var(--rune-color-text-subtle)",
  accent: "var(--rune-color-accent)",
  accentMuted: "var(--rune-color-accent-muted)",
  border: "var(--rune-color-border)",
  borderMuted: "var(--rune-color-border-muted)",
  success: "var(--rune-color-success)",
  warning: "var(--rune-color-warning)",
  danger: "var(--rune-color-danger)",
  info: "var(--rune-color-info)",
  shadow: "var(--rune-color-shadow)",
  overlay: "var(--rune-color-overlay)",
};

const webTypography = {
  ...uiThemeLight.typography,
  fontFamily: "var(--rune-font-family)",
};

export function getWebThemeProxy(scheme: "light" | "dark"): UITheme {
  // We respect the scheme only for numeric values if they differed (currently they don't in defaults),
  // but for colors we return the CSS variables which handle the switch via classes.
  return {
    ...uiThemeLight, // Start with light defaults (shared spacing/sizes)
    scheme,
    colors: webColors,
    typography: webTypography,
  };
}
