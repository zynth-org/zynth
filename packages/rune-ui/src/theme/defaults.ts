import type { UIColors, UITheme, UIThemeTokens } from "./types";

const sharedTypography = {
  fontFamily: "System",
  fontFamilyMono: "monospace",
  fontSizes: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 18,
    xl: 22,
    "2xl": 28,
    "3xl": 32,
  },
  fontWeights: {
    regular: "400",
    medium: "500",
    semibold: "600",
    bold: "700",
  },
  lineHeights: {
    xs: 16,
    sm: 20,
    md: 24,
    lg: 26,
    xl: 30,
    "2xl": 36,
    "3xl": 40,
  },
  letterSpacings: {
    tight: -0.3,
    normal: 0,
    wide: 0.6,
  },
} satisfies UIThemeTokens["typography"];

const sharedSpacing = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  "3xl": 40,
} satisfies UIThemeTokens["spacing"];

const sharedRadii = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 999,
} satisfies UIThemeTokens["radii"];

const sharedSizes = {
  controlSm: 32,
  controlMd: 40,
  controlLg: 48,
  iconSm: 16,
  iconMd: 20,
  iconLg: 24,
} satisfies UIThemeTokens["sizes"];

const lightColors: UIColors = {
  background: "#F7F7F8",
  surface: "#FFFFFF",
  surfaceAlt: "#F0F1F4",
  card: "#FFFFFF",
  text: "#0F172A",
  textMuted: "#334155",
  textSubtle: "#64748B",
  accent: "#2563EB",
  accentMuted: "#DBEAFE",
  border: "#E2E8F0",
  borderMuted: "#F1F5F9",
  success: "#16A34A",
  warning: "#D97706",
  danger: "#DC2626",
  info: "#0284C7",
  shadow: "rgba(15, 23, 42, 0.18)",
  overlay: "rgba(15, 23, 42, 0.5)",
};

const darkColors: UIColors = {
  background: "#0B1120",
  surface: "#111827",
  surfaceAlt: "#0F172A",
  card: "#111827",
  text: "#F8FAFC",
  textMuted: "#CBD5F5",
  textSubtle: "#94A3B8",
  accent: "#60A5FA",
  accentMuted: "#1E3A8A",
  border: "#1F2937",
  borderMuted: "#0F172A",
  success: "#22C55E",
  warning: "#F59E0B",
  danger: "#F87171",
  info: "#38BDF8",
  shadow: "rgba(0, 0, 0, 0.45)",
  overlay: "rgba(0, 0, 0, 0.6)",
};

export const uiThemeTokensLight: UIThemeTokens = {
  colors: lightColors,
  typography: sharedTypography,
  spacing: sharedSpacing,
  radii: sharedRadii,
  sizes: sharedSizes,
};

export const uiThemeTokensDark: UIThemeTokens = {
  colors: darkColors,
  typography: sharedTypography,
  spacing: sharedSpacing,
  radii: sharedRadii,
  sizes: sharedSizes,
};

export const uiThemeLight: UITheme = {
  scheme: "light",
  ...uiThemeTokensLight,
};

export const uiThemeDark: UITheme = {
  scheme: "dark",
  ...uiThemeTokensDark,
};
