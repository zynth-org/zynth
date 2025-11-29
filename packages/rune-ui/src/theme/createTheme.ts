import type {
  ColorScheme,
  UITheme,
  UIThemeOverride,
  UIThemeTokens,
} from "./types";
import { uiThemeDark, uiThemeLight } from "./defaults";

export function getBaseTheme(scheme: ColorScheme): UITheme {
  return scheme === "dark" ? uiThemeDark : uiThemeLight;
}

export function mergeUIThemeTokens(
  base: UIThemeTokens,
  overrides?: UIThemeOverride
): UIThemeTokens {
  if (!overrides || Object.keys(overrides).length === 0) {
    return base;
  }

  const colors = overrides.colors
    ? { ...base.colors, ...overrides.colors }
    : base.colors;
  const typography = overrides.typography
    ? {
        ...base.typography,
        ...overrides.typography,
        fontSizes: overrides.typography.fontSizes
          ? { ...base.typography.fontSizes, ...overrides.typography.fontSizes }
          : base.typography.fontSizes,
        fontWeights: overrides.typography.fontWeights
          ? {
              ...base.typography.fontWeights,
              ...overrides.typography.fontWeights,
            }
          : base.typography.fontWeights,
        lineHeights: overrides.typography.lineHeights
          ? {
              ...base.typography.lineHeights,
              ...overrides.typography.lineHeights,
            }
          : base.typography.lineHeights,
        letterSpacings: overrides.typography.letterSpacings
          ? {
              ...base.typography.letterSpacings,
              ...overrides.typography.letterSpacings,
            }
          : base.typography.letterSpacings,
      }
    : base.typography;
  const spacing = overrides.spacing
    ? { ...base.spacing, ...overrides.spacing }
    : base.spacing;
  const radii = overrides.radii
    ? { ...base.radii, ...overrides.radii }
    : base.radii;
  const sizes = overrides.sizes
    ? { ...base.sizes, ...overrides.sizes }
    : base.sizes;

  if (
    colors === base.colors &&
    typography === base.typography &&
    spacing === base.spacing &&
    radii === base.radii &&
    sizes === base.sizes
  ) {
    return base;
  }

  return {
    colors,
    typography,
    spacing,
    radii,
    sizes,
  };
}

export function createUITheme(
  scheme: ColorScheme,
  overrides?: UIThemeOverride
): UITheme {
  const base = getBaseTheme(scheme);
  if (!overrides || Object.keys(overrides).length === 0) {
    return base;
  }

  const tokens = mergeUIThemeTokens(base, overrides);
  if (tokens === base) {
    return base;
  }

  return {
    scheme,
    ...tokens,
  };
}
