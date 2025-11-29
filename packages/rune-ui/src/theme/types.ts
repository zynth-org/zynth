export type ColorScheme = "light" | "dark";
export type ThemeMode = ColorScheme | "system";

export type FontWeight =
  | "100"
  | "200"
  | "300"
  | "400"
  | "500"
  | "600"
  | "700"
  | "800"
  | "900";

export type UIColors = {
  background: string;
  surface: string;
  surfaceAlt: string;
  card: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  accent: string;
  accentMuted: string;
  border: string;
  borderMuted: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  shadow: string;
  overlay: string;
};

export type UITypography = {
  fontFamily: string;
  fontFamilyMono: string;
  fontSizes: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    "2xl": number;
    "3xl": number;
  };
  fontWeights: {
    regular: FontWeight;
    medium: FontWeight;
    semibold: FontWeight;
    bold: FontWeight;
  };
  lineHeights: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    "2xl": number;
    "3xl": number;
  };
  letterSpacings: {
    tight: number;
    normal: number;
    wide: number;
  };
};

export type UISpacing = {
  none: number;
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  "2xl": number;
  "3xl": number;
};

export type UIRadii = {
  none: number;
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  full: number;
};

export type UISizes = {
  controlSm: number;
  controlMd: number;
  controlLg: number;
  iconSm: number;
  iconMd: number;
  iconLg: number;
};

export type UIThemeTokens = {
  colors: UIColors;
  typography: UITypography;
  spacing: UISpacing;
  radii: UIRadii;
  sizes: UISizes;
};

export type UITheme = UIThemeTokens & {
  scheme: ColorScheme;
};

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export type UIThemeOverride = DeepPartial<UIThemeTokens>;
