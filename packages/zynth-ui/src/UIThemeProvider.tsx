import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  runWithOwner,
  type Accessor,
  type Component,
  type Element,
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
  children?: Element;
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
    getSystemColorScheme(),
    { ownedWrite: true }
  );

  const shouldFollowSystem = createMemo(() => {
    if (props.followSystem !== undefined) {
      return props.followSystem;
    }
    return (props.colorScheme ?? "system") === "system";
  });

  createEffect(
    () => shouldFollowSystem(),
    (follow) => {
      if (!follow) return;
      setSystemScheme(getSystemColorScheme());
      const unsubscribe = subscribeToSystemColorScheme((scheme) => {
        runWithOwner(null, () => setSystemScheme(scheme));
      });
      const retryIds: Array<ReturnType<typeof setTimeout>> = [];
      const schedule = (globalThis as unknown as { setTimeout?: (handler: () => void, timeout: number) => ReturnType<typeof setTimeout> }).setTimeout;
      const clear = (globalThis as unknown as { clearTimeout?: (id: ReturnType<typeof setTimeout>) => void }).clearTimeout;

      if (typeof schedule === "function") {
        const retryDelays = [0, 32, 128, 512, 1500];
        for (const delay of retryDelays) {
          const retryId = schedule(() => {
            const next = getSystemColorScheme();
            if (next !== systemScheme()) {
              runWithOwner(null, () => setSystemScheme(next));
            }
          }, delay);
          retryIds.push(retryId);
        }
      }

      return () => {
        if (typeof clear === "function") {
          for (const retryId of retryIds) {
            clear(retryId);
          }
        }
        unsubscribe();
      };
    }
  );

  const scheme = createMemo<ColorScheme>(() => {
    if (shouldFollowSystem()) {
      return systemScheme();
    }
    return resolveExplicitScheme(props.colorScheme);
  });

  createEffect(
    () => ({ currentScheme: scheme(), webTheme: props.webTheme }),
    ({ currentScheme, webTheme }) => {
      if (typeof document === "undefined") return;

      const root = document.body;

      // Toggle Scheme class
      if (currentScheme === "dark") {
        root.classList.add("zynth-scheme-dark");
        root.classList.remove("zynth-scheme-light");
      } else {
        root.classList.add("zynth-scheme-light");
        root.classList.remove("zynth-scheme-dark");
      }

      // Toggle Web Theme class
      if (webTheme) {
        if (webTheme === "ios") {
          root.classList.add("zynth-theme-ios");
          root.classList.remove("zynth-theme-android");
        } else if (webTheme === "android") {
          root.classList.add("zynth-theme-android");
          root.classList.remove("zynth-theme-ios");
        }
      }
    }
  );

  const theme = createMemo<UITheme>(() => {
    if (props.webTheme) {
      return getWebThemeProxy(scheme());
    }
    return createUITheme(scheme(), props.theme);
  });

  return (
    <UIThemeContext value={theme}>
      {props.children}
    </UIThemeContext>
  );
};
