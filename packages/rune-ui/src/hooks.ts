import { createMemo, useContext, type Accessor } from "solid-js";
import { UIThemeContext } from "./UIThemeProvider";
import type { ColorScheme, UITheme } from "./theme";

/**
 * Access the current UI theme as a reactive accessor.
 */
export function useUITheme(): Accessor<UITheme> {
  return useContext(UIThemeContext);
}

/**
 * Access the resolved color scheme (light/dark).
 */
export function useUIColorScheme(): Accessor<ColorScheme> {
  const theme = useUITheme();
  return createMemo(() => theme().scheme);
}
