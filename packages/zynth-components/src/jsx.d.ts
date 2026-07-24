import type { Style, StyleRef } from "@zynthjs/core";
import type { Element as SolidElement } from "solid-js";
import type { ImageElementProps } from "./primitives/Image";
import type { TextInputProps } from "./primitives/TextInput";
import type { TextFieldProps } from "./primitives/TextField";
import type { ProgressIndicatorProps } from "./primitives/ProgressIndicator";
import type { SwitchProps } from "./primitives/Switch";
import type { StatusBarProps } from "./primitives/StatusBar";
import type { SliderProps } from "./primitives/Slider";
import type { BottomSheetProps } from "./primitives/BottomSheet";
import type {
  FlingGestureEvent,
  LongPressGestureEvent,
  PanGestureEvent,
  PinchGestureEvent,
  RotationGestureEvent,
  TapGestureEvent,
} from "@zynthjs/core/gesture";

type ZynthChildren = SolidElement | SolidElement[] | null | undefined;
type SolidButtonProps = { [key: string]: unknown };

interface ViewElementProps {
  style?: Style | StyleRef;
  children?: ZynthChildren;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: "button" | "header" | "link" | "none";
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
  enableGlassIOS?: boolean;
  tintColor?: string;
  testID?: string;
  key?: string | number;
  ref?: (node: any) => void;
  layout?: unknown;
  __zynthExiting?: unknown;
  onLayout?: (event: {
    nativeEvent: {
      layout: {
        x: number;
        y: number;
        width: number;
        height: number;
      };
    };
  }) => void;
}

interface GlassViewElementProps {
  style?: Style | StyleRef;
  children?: ZynthChildren;
  glassEffect?: "regular" | "clear" | "none";
  interactive?: boolean;
  tintColor?: string;
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
  testID?: string;
}

interface GlassContainerElementProps {
  style?: Style | StyleRef;
  children?: ZynthChildren;
  spacing?: number;
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
  testID?: string;
}

interface BlurViewElementProps {
  style?: Style | StyleRef;
  children?: ZynthChildren;
  blurIntensity?: number;
  blurTint?: "default" | "light" | "dark";
  blurVariant?: "blur" | "glass";
  interactive?: boolean;
  tintColor?: string;
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
  testID?: string;
}

interface TextElementProps {
  style?: Style | StyleRef;
  children?: ZynthChildren;
  text?: string;
  ref?: (node: any) => void;
}

declare module "solid-js/jsx-runtime" {
  namespace JSX {
    interface IntrinsicElements {
      view: ViewElementProps;
      text: TextElementProps;
      image: ImageElementProps;
      "text-input": TextInputProps & { [key: string]: any };
      "secure-text-input": TextInputProps & { [key: string]: any };
      "scroll-view": ViewElementProps & { [key: string]: any };
      "recycler-scroll-view": ViewElementProps & { [key: string]: any };
      pressable: ViewElementProps & { [key: string]: any };
      button: SolidButtonProps & { testID?: string };
      "glass-view": GlassViewElementProps & { [key: string]: any };
      "glass-container": GlassContainerElementProps & { [key: string]: any };
      "blur-view": BlurViewElementProps & { [key: string]: any };
      "progress-indicator": ProgressIndicatorProps & { [key: string]: any };
      "switch-view": SwitchProps & { [key: string]: any };
      "slider-view": SliderProps & { [key: string]: any };
      "text-field": TextFieldProps & { [key: string]: any };
      "zynth-alert": { [key: string]: any };
      "zynth-status-bar": StatusBarProps & { [key: string]: any };
      "menu-view": ViewElementProps & { [key: string]: any };
      "menu-trigger-view": ViewElementProps & { [key: string]: any };
      "popover-view": ViewElementProps & { [key: string]: any };
      "popover-trigger-view": ViewElementProps & { [key: string]: any };
      "popover-content-view": ViewElementProps & { [key: string]: any };
      svg: { [key: string]: any };
      path: { [key: string]: any };
      "menu-item-view": ViewElementProps & {
        label?: string;
        destructive?: boolean;
        disabled?: boolean;
        [key: string]: any;
      };
      "date-picker-view": { [key: string]: any };
      "date-picker-trigger-view": { [key: string]: any };
      "zynth-modal": ViewElementProps & { [key: string]: any };
      "zynth-bottom-sheet": BottomSheetProps & { [key: string]: any };
      "zynth-gesture-detector": {
        style?: Style | StyleRef;
        pointerEvents?: "auto" | "none" | "box-none" | "box-only";
        panSharedSignalX?: number;
        panSharedSignalY?: number;
        testID?: string;
        longPressMinDurationMs?: number;
        flingMinVelocity?: number;
        ref?: (node: any) => void;
        onTapGesture?: (event: TapGestureEvent) => void;
        onLongPressGesture?: (event: LongPressGestureEvent) => void;
        onRotationGesture?: (event: RotationGestureEvent) => void;
        onPinchGesture?: (event: PinchGestureEvent) => void;
        onFlingGesture?: (event: FlingGestureEvent) => void;
        onPanGesture?: (event: PanGestureEvent) => void;
        children?: ZynthChildren;
      };
    }
  }
}

export {};
