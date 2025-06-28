import {
  ParentComponent,
  createContext,
  createEffect,
  createSignal,
  createUniqueId,
  onCleanup,
  useContext,
} from "solid-js";
import type { JSX } from "solid-js";
import type { Style } from "@rune/core";
import { View } from "@rune/components";
import type { ScreenProps } from "./Screen";
import { useNavigationController } from "./context";
import { registerBottomSheetNavigatorNative } from "./nativeBridge";
import type {
  BottomSheetNavigatorOptions,
  BottomSheetScreenOptions,
  ScreenOptions,
} from "./types";

interface BottomSheetNavigatorContextValue {
  navigatorId: string;
  registerScreen: (definition: BottomSheetScreenRegistration) => () => void;
}

interface BottomSheetScreenRegistration {
  name: string;
  options?: ScreenOptions;
  sheetOptions?: BottomSheetScreenOptions;
}

const BottomSheetNavigatorContext =
  createContext<BottomSheetNavigatorContextValue | null>(null);

function useBottomSheetNavigator(): BottomSheetNavigatorContextValue {
  const context = useContext(BottomSheetNavigatorContext);
  if (!context) {
    throw new Error(
      "[RuneAndroidRouter] <BottomSheet.Screen> must be rendered inside a <BottomSheet> navigator"
    );
  }
  return context;
}

export interface BottomSheetNavigatorProps extends BottomSheetNavigatorOptions {
  id?: string;
  initialRouteName?: string;
  children?: JSX.Element;
}

export interface BottomSheetScreenProps<Params = any>
  extends ScreenProps<Params> {
  sheetOptions?: BottomSheetScreenOptions;
  contentStyle?: Style;
}

type BottomSheetNavigatorComponent =
  ParentComponent<BottomSheetNavigatorProps> & {
    Screen: (props: BottomSheetScreenProps<any>) => JSX.Element | null;
  };

export function createBottomSheetNavigator(): BottomSheetNavigatorComponent {
  const Navigator = ((props: BottomSheetNavigatorProps) => {
    const navigatorId = props.id ?? `bottom-sheet-${createUniqueId()}`;
    const [version, setVersion] = createSignal(0);
    const registrations = new Map<string, BottomSheetScreenRegistration>();

    const registerScreen = (definition: BottomSheetScreenRegistration) => {
      registrations.set(definition.name, definition);
      setVersion((value) => value + 1);
      return () => {
        registrations.delete(definition.name);
        setVersion((value) => value + 1);
      };
    };

    createEffect(() => {
      version();
      const payload = {
        navigatorId,
        initialRouteName: props.initialRouteName,
        sheetOptions: resolveNavigatorOptions(props),
        screens: Array.from(registrations.values()).map((entry) => ({
          name: entry.name,
          options: entry.options,
          sheet: entry.sheetOptions,
        })),
      };
      void registerBottomSheetNavigatorNative(payload);
    });

    return (
      <BottomSheetNavigatorContext.Provider
        value={{ navigatorId, registerScreen }}
      >
        {props.children}
      </BottomSheetNavigatorContext.Provider>
    );
  }) as BottomSheetNavigatorComponent;

  const ScreenComponent = (props: BottomSheetScreenProps<any>) => {
    const controller = useNavigationController();
    const navigator = useBottomSheetNavigator();
    const Component = props.component;

    const WrappedComponent = ((screenProps: any) => {
      const mergedStyle =
        props.contentStyle != null
          ? ({
              ...DEFAULT_BOTTOM_SHEET_CONTENT_STYLE,
              ...props.contentStyle,
            } as Style)
          : DEFAULT_BOTTOM_SHEET_CONTENT_STYLE;
      return (
        <View style={mergedStyle}>
          <Component {...screenProps} />
        </View>
      );
    }) as ScreenProps<any>["component"];

    createEffect(() => {
      const unregister = controller.registerScreen({
        name: props.name,
        component: WrappedComponent,
        options: props.options,
        surface: "bottomSheet",
      });
      onCleanup(unregister);
    });

    createEffect(() => {
      const unregister = navigator.registerScreen({
        name: props.name,
        options: props.options,
        sheetOptions: resolveScreenSheetOptions(props),
      });
      onCleanup(unregister);
    });

    return null;
  };

  Navigator.Screen = ScreenComponent;
  return Navigator;
}

const DEFAULT_BOTTOM_SHEET_CONTENT_STYLE: Style = {
  backgroundColor: "transparent",
  borderRadius: 16,
  minHeight: 100,
  flex: 1,
};

function resolveNavigatorOptions(
  props: BottomSheetNavigatorProps
): BottomSheetNavigatorOptions | undefined {
  return pruneUndefined({
    snapPoints: props.snapPoints,
    initialSnapIndex: props.initialSnapIndex,
    overlayColor: props.overlayColor,
    overlayOpacity: props.overlayOpacity,
    dismissOnOverlayPress: props.dismissOnOverlayPress,
    enableDynamicSizing: props.enableDynamicSizing,
  });
}

function resolveScreenSheetOptions(
  props: BottomSheetScreenProps<any>
): BottomSheetScreenOptions | undefined {
  const provided = props.sheetOptions ?? props.options?.bottomSheet;
  if (!provided) {
    return undefined;
  }
  return pruneUndefined({ ...provided });
}

function pruneUndefined<T extends Record<string, any>>(
  value: T
): T | undefined {
  const entries = Object.entries(value).filter(
    ([, entryValue]) => entryValue !== undefined
  );
  if (entries.length === 0) {
    return undefined;
  }
  return Object.fromEntries(entries) as T;
}
