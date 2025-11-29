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

const UIThemeContext = createContext<Accessor<UITheme>>(() => uiThemeLight);

export { UIThemeContext };

export interface UIThemeProviderProps {
  children: JSX.Element;
  theme?: UIThemeOverride;
  colorScheme?: ThemeMode;
  followSystem?: boolean;
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
    let retryId: ReturnType<typeof setTimeout> | null = null;
    const schedule = (globalThis as any)?.setTimeout as
      | ((handler: () => void, timeout: number) => ReturnType<typeof setTimeout>)
      | undefined;
    const clear = (globalThis as any)?.clearTimeout as
      | ((id: ReturnType<typeof setTimeout>) => void)
      | undefined;

    if (typeof schedule === "function") {
      retryId = schedule(() => {
        const next = getSystemColorScheme();
        if (next !== systemScheme()) {
          setSystemScheme(next);
        }
      }, 0);
    }

    onCleanup(() => {
      if (retryId !== null && typeof clear === "function") {
        clear(retryId);
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

  const theme = createMemo<UITheme>(() => {
    return createUITheme(scheme(), props.theme);
  });

  return (
    <UIThemeContext.Provider value={theme}>
      {props.children}
    </UIThemeContext.Provider>
  );
};
