import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type Accessor,
  type Component,
  type JSX,
} from "solid-js";
import {
  createUITheme,
  getSystemColorScheme,
  subscribeToSystemColorScheme,
  uiThemeLight,
  type ColorScheme,
  type ThemeMode,
  type UITheme,
  type UIThemeOverride,
} from "./theme";
import { getWebThemeProxy } from "./theme/webProxy";
import "./themes/variables.css";
import "./themes/ios.css";
import "./themes/android.css";

const UIThemeContext = createContext<Accessor<UITheme>>(() => uiThemeLight);

export { UIThemeContext };

export interface UIThemeProviderProps {
  children: JSX.Element;
  theme?: UIThemeOverride;
  colorScheme?: ThemeMode;
  followSystem?: boolean;
  webTheme?: "ios" | "android";
}

const resolveExplicitScheme = (mode: ThemeMode | undefined): ColorScheme => {
  if (mode === "light" || mode === "dark") {
    return mode;
  }
  return "light";
};

export const UIThemeProvider: Component<UIThemeProviderProps> = (props) => {
  const [systemScheme, setSystemScheme] = createSignal<ColorScheme>(
    getSystemColorScheme()
  );

  const shouldFollowSystem = createMemo(() => {
    if (props.followSystem !== undefined) {
      return props.followSystem;
    }
    return (props.colorScheme ?? "system") === "system";
  });

  createEffect(() => {
    if (!shouldFollowSystem()) return;
    setSystemScheme(getSystemColorScheme());
    const unsubscribe = subscribeToSystemColorScheme((scheme) => {
      setSystemScheme(scheme);
    });
    const retryIds: Array<ReturnType<typeof setTimeout>> = [];
    const schedule = (globalThis as any)?.setTimeout as
      | ((handler: () => void, timeout: number) => ReturnType<typeof setTimeout>)
      | undefined;
    const clear = (globalThis as any)?.clearTimeout as
      | ((id: ReturnType<typeof setTimeout>) => void)
      | undefined;

    if (typeof schedule === "function") {
      const retryDelays = [0, 32, 128, 512, 1500];
      for (const delay of retryDelays) {
        const retryId = schedule(() => {
          const next = getSystemColorScheme();
          if (next !== systemScheme()) {
            setSystemScheme(next);
          }
        }, delay);
        retryIds.push(retryId);
      }
    }

    onCleanup(() => {
      if (typeof clear === "function") {
        for (const retryId of retryIds) {
          clear(retryId);
        }
      }
      unsubscribe();
    });
  });

  const scheme = createMemo<ColorScheme>(() => {
    if (shouldFollowSystem()) {
      return systemScheme();
    }
    return resolveExplicitScheme(props.colorScheme);
  });

  createEffect(() => {
    if (typeof document === "undefined") return;

    const root = document.body;
    const currentScheme = scheme();

    // Toggle Scheme class
    if (currentScheme === "dark") {
      root.classList.add("zynth-scheme-dark");
      root.classList.remove("zynth-scheme-light");
    } else {
      root.classList.add("zynth-scheme-light");
      root.classList.remove("zynth-scheme-dark");
    }

    // Toggle Web Theme class
    if (props.webTheme) {
      if (props.webTheme === "ios") {
        root.classList.add("zynth-theme-ios");
        root.classList.remove("zynth-theme-android");
      } else if (props.webTheme === "android") {
        root.classList.add("zynth-theme-android");
        root.classList.remove("zynth-theme-ios");
      }
    }
  });

  const theme = createMemo<UITheme>(() => {
    if (props.webTheme) {
      return getWebThemeProxy(scheme());
    }
    return createUITheme(scheme(), props.theme);
  });

  return (
    <UIThemeContext.Provider value={theme}>
      {props.children}
    </UIThemeContext.Provider>
  );
};
