import { uiThemeLight } from "./defaults";
import type { UITheme } from "./types";

// We use the light theme structure as a base for spacing/sizes/etc.
// The colors will be replaced by CSS variables.
const webColors = {
  background: "var(--zynth-color-background)",
  surface: "var(--zynth-color-surface)",
  surfaceAlt: "var(--zynth-color-surface-alt)",
  card: "var(--zynth-color-card)",
  text: "var(--zynth-color-text)",
  textMuted: "var(--zynth-color-text-muted)",
  textSubtle: "var(--zynth-color-text-subtle)",
  accent: "var(--zynth-color-accent)",
  accentMuted: "var(--zynth-color-accent-muted)",
  border: "var(--zynth-color-border)",
  borderMuted: "var(--zynth-color-border-muted)",
  success: "var(--zynth-color-success)",
  warning: "var(--zynth-color-warning)",
  danger: "var(--zynth-color-danger)",
  info: "var(--zynth-color-info)",
  shadow: "var(--zynth-color-shadow)",
  overlay: "var(--zynth-color-overlay)",
};

const webTypography = {
  ...uiThemeLight.typography,
  fontFamily: "var(--zynth-font-family)",
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
